/* MEA Electric Bill Card (Type 1.2 Progressive with Solar Deduct)
 * Version: 1.3.0
 * Custom Lovelace Card for MEA (Metropolitan Electricity Authority, Thailand)
 */

const DEFAULT_RATES = {
  serviceCharge: 24.62,
  tiers: [
    { upTo: 150, rate: 3.2484 },
    { upTo: 400, rate: 4.2218 },
    { upTo: Infinity, rate: 4.4217 },
  ],
};

const VAT_DEFAULT = 7;
const FT_DEFAULT = 0.3972;

function tieredEnergyCharge(units, tiers) {
  let remaining = Math.max(0, units);
  let prevLimit = 0;
  let total = 0;
  for (const tier of tiers) {
    const blockSize = Math.min(remaining, tier.upTo - prevLimit);
    if (blockSize > 0) {
      total += blockSize * tier.rate;
      remaining -= blockSize;
    }
    prevLimit = tier.upTo;
    if (remaining <= 0) break;
  }
  return total;
}

function getCycleStart(cutoffDay, now) {
  let start = new Date(now.getFullYear(), now.getMonth(), cutoffDay, 0, 0, 0, 0);
  if (start > now) {
    start = new Date(now.getFullYear(), now.getMonth() - 1, cutoffDay, 0, 0, 0, 0);
  }
  return start;
}

const PERIODS = {
  day: { label: "Day" },
  week: { label: "Week" },
  month: { label: "Month" },
  cycle: { label: "Bill cycle" },
};

function getPeriodStart(period, cutoffDay, now) {
  if (period === "day") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  }
  if (period === "week") {
    const diffToMonday = (now.getDay() + 6) % 7;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday, 0, 0, 0, 0);
  }
  if (period === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  }
  return getCycleStart(cutoffDay, now);
}

async function fetchSeries(hass, entityId, start, end) {
  if (!entityId) return [];
  const path = `history/period/${start.toISOString()}?filter_entity_id=${entityId}&end_time=${end.toISOString()}&minimal_response`;
  let series;
  try {
    series = await hass.callApi("GET", path);
  } catch (err) {
    return [];
  }
  if (!series || !series[0]) return [];
  return series[0]
    .map((p) => ({
      time: new Date(p.last_changed),
      value: parseFloat(p.state),
    }))
    .filter((p) => !Number.isNaN(p.value))
    .sort((a, b) => a.time - b.time);
}

async function fetchStatPoints(hass, entityId, start, end) {
  if (!entityId) return [];
  const queryStart = new Date(start.getTime() - 60 * 60 * 1000);
  let result;
  try {
    result = await hass.callWS({
      type: "recorder/statistics_during_period",
      start_time: queryStart.toISOString(),
      end_time: end.toISOString(),
      statistic_ids: [entityId],
      period: "hour",
      types: ["sum"],
    });
  } catch (err) {
    return [];
  }
  const series = (result && result[entityId]) || [];
  const points = series
    .filter((p) => p.sum != null)
    .map((p) => ({ time: new Date(p.end), value: p.sum }))
    .filter((p) => p.time.getTime() <= end.getTime())
    .sort((a, b) => a.time - b.time);

  while (points.length > 1 && points[points.length - 1].value === points[points.length - 2].value) {
    points.pop();
  }
  return points;
}

const STATS_SAFETY_MARGIN_MS = 3 * 60 * 60 * 1000;

async function fetchUsageSegments(hass, entityId, start, end) {
  if (!entityId) return [];
  const safeStatsEnd = new Date(Math.max(start.getTime(), end.getTime() - STATS_SAFETY_MARGIN_MS));
  const statPoints =
    safeStatsEnd.getTime() > start.getTime() ? await fetchStatPoints(hass, entityId, start, safeStatsEnd) : [];
  const tailStart = statPoints.length ? statPoints[statPoints.length - 1].time : start;
  const tailPoints = await fetchSeries(hass, entityId, tailStart, end);
  const segments = [];
  if (statPoints.length) segments.push({ source: "stats", points: statPoints });
  if (tailPoints.length) segments.push({ source: "history", points: tailPoints });
  return segments;
}

function totalUsageMulti(segments) {
  return segments.reduce((sum, seg) => sum + totalUsage(seg.points), 0);
}

function totalUsage(points) {
  if (!points.length) return 0;
  const first = points[0].value;
  const last = points[points.length - 1].value;
  if (last < first) {
    return last;
  }
  return last - first;
}

class MeaElectricBillCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("mea-electric-bill-card-editor");
  }

  static getStubConfig() {
    return {
      type: "custom:mea-electric-bill-card",
      name: "MEA Electric Bill (Type 1.2)",
      cutoff_day: 1,
      ft_baht: FT_DEFAULT,
      service_charge: DEFAULT_RATES.serviceCharge,
      vat: VAT_DEFAULT,
      default_period: "cycle",
      entity_total: "",
      entity_solar: "",
    };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    if (!config.entity_total) {
      throw new Error("entity_total (Sensor ใช้ไฟรวม) is required");
    }
    const cutoffDay = Number(config.cutoff_day || 1);
    if (cutoffDay < 1 || cutoffDay > 31) {
      throw new Error("cutoff_day must be between 1 and 31");
    }
    const defaultPeriod = PERIODS[config.default_period] ? config.default_period : "cycle";

    this._config = {
      name: config.name || "MEA Electric Bill",
      cutoff_day: cutoffDay,
      ft_baht: config.ft_baht != null ? Number(config.ft_baht) : FT_DEFAULT,
      service_charge: config.service_charge != null ? Number(config.service_charge) : DEFAULT_RATES.serviceCharge,
      vat: Number(config.vat ?? VAT_DEFAULT),
      entity_total: config.entity_total || "",
      entity_solar: config.entity_solar || "",
      rates: config.rates || DEFAULT_RATES,
    };
    if (!this._period) this._period = defaultPeriod;
    this._lastFetch = 0;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const now = Date.now();
    if (now - (this._lastFetch || 0) > 60000) {
      this._lastFetch = now;
      this._updateUsage();
    } else {
      this._render();
    }
  }

  getCardSize() {
    return 4;
  }

  _setPeriod(period) {
    if (this._period === period) return;
    this._period = period;
    this._lastFetch = 0;
    this._updateUsage();
  }

  async _updateUsage() {
    if (!this._hass || !this._config) return;
    const cfg = this._config;
    const now = new Date();
    const start = getPeriodStart(this._period || "cycle", cfg.cutoff_day, now);

    const totalSegs = await fetchUsageSegments(this._hass, cfg.entity_total, start, now);
    const totalUnits = totalUsageMulti(totalSegs);

    let solarUnits = 0;
    if (cfg.entity_solar) {
      const solarSegs = await fetchUsageSegments(this._hass, cfg.entity_solar, start, now);
      solarUnits = totalUsageMulti(solarSegs);
    }

    const netUnits = Math.max(0, totalUnits - solarUnits);

    this._usage = {
      totalUnits,
      solarUnits,
      netUnits,
    };

    this._cycleStart = start;
    this._render();
  }

  _calcBill() {
    const cfg = this._config;
    const vat = cfg.vat;
    const ft = cfg.ft_baht != null ? cfg.ft_baht : FT_DEFAULT;
    const rateSet = cfg.rates.tiers ? cfg.rates : DEFAULT_RATES;
    
    const units = this._usage ? this._usage.netUnits : 0;
    const energyCharge = tieredEnergyCharge(units, rateSet.tiers);
    const serviceCharge = cfg.service_charge != null ? cfg.service_charge : DEFAULT_RATES.serviceCharge;
    
    const lines = [];
    lines.push([`Energy charge (${units.toFixed(2)} units)`, energyCharge]);
    lines.push(["Service charge", serviceCharge]);

    const ftCharge = units * ft;
    lines.push([`Ft (${ft.toFixed(4)} ฿/unit)`, ftCharge]);
    
    const subtotal = energyCharge + serviceCharge + ftCharge;
    const vatAmount = subtotal * (vat / 100);
    lines.push([`VAT (${vat}%)`, vatAmount]);
    const total = subtotal + vatAmount;

    return { units, lines, total };
  }

  _render() {
    if (!this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });

    const bill = this._calcBill();
    const period = this._period || "cycle";
    const cycleLabel = this._cycleStart
      ? `Since ${this._cycleStart.toLocaleDateString()}`
      : "Loading usage…";

    const tabs = Object.entries(PERIODS)
      .map(
        ([key, def]) =>
          `<button class="tab${key === period ? " active" : ""}" data-period="${key}">${def.label}</button>`
      )
      .join("");

    const rows = bill.lines
      .map(
        ([label, value]) =>
          `<tr><td>${label}</td><td class="num">${value.toFixed(2)} ฿</td></tr>`
      )
      .join("");

    const totalU = this._usage ? this._usage.totalUnits.toFixed(2) : "0.00";
    const solarU = this._usage ? this._usage.solarUnits.toFixed(2) : "0.00";
    const netU = this._usage ? this._usage.netUnits.toFixed(2) : "0.00";

    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 16px; }
        .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
        .cycle { font-size: 0.85em; color: var(--secondary-text-color); }
        table { width: 100%; border-collapse: collapse; font-size: 0.95em; }
        td { padding: 4px 0; }
        td.num { text-align: right; }
        .total-row td { font-weight: bold; border-top: 1px solid var(--divider-color); padding-top: 8px; }
        .scheme-badge {
          font-size: 0.75em;
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
          border-radius: 8px;
          padding: 2px 8px;
        }
        .tabs { display: flex; gap: 4px; margin-bottom: 12px; }
        .tab {
          flex: 1;
          padding: 6px 0;
          border: none;
          border-radius: 6px;
          background: var(--secondary-background-color, #eee);
          color: var(--primary-text-color);
          font-size: 0.85em;
          cursor: pointer;
        }
        .tab.active {
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }
        .summary-box {
          background: var(--secondary-background-color, #f7f7f7);
          border-radius: 8px;
          padding: 10px;
          margin-bottom: 12px;
          font-size: 0.9em;
        }
        .summary-row {
          display: flex;
          justify-content: space-between;
          padding: 2px 0;
        }
        .summary-row.net {
          font-weight: bold;
          border-top: 1px dashed var(--divider-color);
          margin-top: 4px;
          padding-top: 4px;
          color: var(--primary-color);
        }
      </style>
      <ha-card>
        <div class="header">
          <div>
            <div>${this._config.name}</div>
            <div class="cycle">${cycleLabel}</div>
          </div>
          <span class="scheme-badge">MEA Type 1.2</span>
        </div>
        <div class="tabs">${tabs}</div>

        <div class="summary-box">
          <div class="summary-row">
            <span>พลังงานไฟฟ้าที่ใช้ทั้งหมด:</span>
            <span>${totalU} kWh</span>
          </div>
          <div class="summary-row">
            <span>พลังงานจาก Solar Cell:</span>
            <span>-${solarU} kWh</span>
          </div>
          <div class="summary-row net">
            <span>หน่วยไฟฟ้าคงเหลือคิดเงิน:</span>
            <span>${netU} kWh</span>
          </div>
        </div>

        <table>
          ${rows}
          <tr class="total-row"><td>Estimated Total</td><td class="num">${bill.total.toFixed(2)} ฿</td></tr>
        </table>
      </ha-card>
    `;

    this.shadowRoot.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => this._setPeriod(btn.dataset.period));
    });
  }
}

class MeaElectricBillCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...MeaElectricBillCard.getStubConfig(), ...config };
    this._rates = structuredClone(DEFAULT_RATES);
    if (config.rates) Object.assign(this._rates, config.rates);
    this._render();
  }

  set hass(hass) {
    const firstHass = !this._hass;
    this._hass = hass;
    if (this._config && firstHass) this._render();
  }

  _emit() {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _valueChanged(field, value) {
    const cfg = { ...this._config, [field]: value };
    this._config = cfg;
    this._emit();
    this._render();
  }

  _render() {
    if (!this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const cfg = this._config;

    this.shadowRoot.innerHTML = `
      <style>
        .row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
        label { font-size: 0.85em; color: var(--secondary-text-color); }
        input, select { padding: 6px; border-radius: 4px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
        .two-col { display: flex; gap: 12px; }
        .two-col .row { flex: 1; }
      </style>
      <div class="row">
        <label>Name</label>
        <input id="name" type="text" value="${cfg.name}" />
      </div>
      <div class="two-col">
        <div class="row">
          <label>Bill Cutoff Day (1-31)</label>
          <input id="cutoff_day" type="number" min="1" max="31" value="${cfg.cutoff_day}" />
        </div>
        <div class="row">
          <label>Default View</label>
          <select id="default_period">
            ${Object.entries(PERIODS)
              .map(
                ([key, def]) =>
                  `<option value="${key}" ${cfg.default_period === key ? "selected" : ""}>${def.label}</option>`
              )
              .join("")}
          </select>
        </div>
      </div>

      <div class="row">
        <label>1. Sensor ใช้ไฟรวมทั้งหมด (cumulative kWh)</label>
        <input id="entity_total" type="text" list="sensor-options" value="${cfg.entity_total}" placeholder="sensor.your_grid_energy_total" />
      </div>

      <div class="row">
        <label>2. Sensor Solar (cumulative kWh - ถ้ามี)</label>
        <input id="entity_solar" type="text" list="sensor-options" value="${cfg.entity_solar}" placeholder="sensor.your_solar_energy_total" />
      </div>

      <datalist id="sensor-options">
        ${this._sensorOptions()}
      </datalist>

      <div class="two-col">
        <div class="row">
          <label>Service Charge (฿/month)</label>
          <input id="service_charge" type="number" step="0.01" value="${cfg.service_charge != null ? cfg.service_charge : DEFAULT_RATES.serviceCharge}" />
        </div>
        <div class="row">
          <label>Ft Rate (฿/unit)</label>
          <input id="ft_baht" type="number" step="0.0001" value="${cfg.ft_baht}" />
        </div>
      </div>
      <div class="row">
        <label>VAT (%)</label>
        <input id="vat" type="number" step="0.1" value="${cfg.vat}" />
      </div>
    `;

    const $ = (id) => this.shadowRoot.getElementById(id);

    $("name").addEventListener("change", (e) => this._valueChanged("name", e.target.value));
    $("cutoff_day").addEventListener("change", (e) => this._valueChanged("cutoff_day", Number(e.target.value)));
    $("default_period").addEventListener("change", (e) => this._valueChanged("default_period", e.target.value));
    $("entity_total").addEventListener("change", (e) => this._valueChanged("entity_total", e.target.value));
    $("entity_solar").addEventListener("change", (e) => this._valueChanged("entity_solar", e.target.value));
    $("service_charge").addEventListener("change", (e) => this._valueChanged("service_charge", Number(e.target.value)));
    $("ft_baht").addEventListener("change", (e) => this._valueChanged("ft_baht", Number(e.target.value)));
    $("vat").addEventListener("change", (e) => this._valueChanged("vat", Number(e.target.value)));
  }

  _sensorOptions() {
    if (!this._hass) return "";
    return Object.keys(this._hass.states)
      .filter((id) => id.startsWith("sensor."))
      .sort()
      .map((id) => `<option value="${id}"></option>`)
      .join("");
  }
}

customElements.define("mea-electric-bill-card", MeaElectricBillCard);
customElements.define("mea-electric-bill-card-editor", MeaElectricBillCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "mea-electric-bill-card",
  name: "MEA Electric Bill Card (Type 1.2)",
  description: "Calculate MEA residential electric bill with Solar deduction.",
});
