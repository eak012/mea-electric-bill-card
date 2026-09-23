/* MEA Electric Bill Card (Type 1.2 Progressive with Solar Deduct & History)
 * Version: 2.2.0 (Clean History: Filter Zero Rows & Added Table Header Icons)
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

function getCycleStart(cutoffDay, cutoffTime, now) {
  const [hours, minutes] = (cutoffTime || "00:00").split(":").map(Number);
  let start = new Date(now.getFullYear(), now.getMonth(), cutoffDay, hours || 0, minutes || 0, 0, 0);
  if (start > now) {
    start = new Date(now.getFullYear(), now.getMonth() - 1, cutoffDay, hours || 0, minutes || 0, 0, 0);
  }
  return start;
}

const PERIODS = {
  day: { label: "Day" },
  week: { label: "Week" },
  month: { label: "Month" },
  cycle: { label: "Bill cycle" },
};

function getPeriodStart(period, cutoffDay, cutoffTime, now) {
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
  return getCycleStart(cutoffDay, cutoffTime, now);
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
      cutoff_day: 24,
      cutoff_time: "09:00",
      ft_baht: FT_DEFAULT,
      service_charge: DEFAULT_RATES.serviceCharge,
      vat: VAT_DEFAULT,
      default_period: "cycle",
      history_months: 3,
      entity_total: "",
      entity_solar: "",
    };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    if (!config.entity_total) {
      throw new Error("entity_total (Sensor ใช้ไฟรวม) is required");
    }
    const cutoffDay = Number(config.cutoff_day || 24);
    if (cutoffDay < 1 || cutoffDay > 31) {
      throw new Error("cutoff_day must be between 1 and 31");
    }
    const defaultPeriod = PERIODS[config.default_period] ? config.default_period : "cycle";

    this._config = {
      name: config.name || "MEA Electric Bill",
      cutoff_day: cutoffDay,
      cutoff_time: config.cutoff_time || "09:00",
      ft_baht: config.ft_baht != null ? Number(config.ft_baht) : FT_DEFAULT,
      service_charge: config.service_charge != null ? Number(config.service_charge) : DEFAULT_RATES.serviceCharge,
      vat: Number(config.vat ?? VAT_DEFAULT),
      history_months: config.history_months != null ? Number(config.history_months) : 3,
      entity_total: config.entity_total || "",
      entity_solar: config.entity_solar || "",
      rates: config.rates || DEFAULT_RATES,
    };
    if (!this._period) this._period = defaultPeriod;
    this._lastFetch = 0;
    this._historyData = [];
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
    return 6;
  }

  _setPeriod(period) {
    if (this._period === period) return;
    this._period = period;
    this._lastFetch = 0;
    this._updateUsage();
  }

  async _calculatePeriodBill(start, end) {
    const cfg = this._config;
    const totalSegs = await fetchUsageSegments(this._hass, cfg.entity_total, start, end);
    const totalUnits = totalUsageMulti(totalSegs);

    let solarUnits = 0;
    if (cfg.entity_solar) {
      const solarSegs = await fetchUsageSegments(this._hass, cfg.entity_solar, start, end);
      solarUnits = totalUsageMulti(solarSegs);
    }

    const netUnits = Math.max(0, totalUnits - solarUnits);
    const bill = this._calcBillFromUnits(netUnits);
    return {
      totalUnits,
      solarUnits,
      netUnits,
      cost: bill.total,
    };
  }

  async _updateUsage() {
    if (!this._hass || !this._config) return;
    const cfg = this._config;
    const now = new Date();
    const start = getPeriodStart(this._period || "cycle", cfg.cutoff_day, cfg.cutoff_time, now);

    const currentUsage = await this._calculatePeriodBill(start, now);
    this._usage = currentUsage;
    this._cycleStart = start;

    const historyMonths = cfg.history_months;
    const historyRows = [];
    const [hours, minutes] = (cfg.cutoff_time || "00:00").split(":").map(Number);

    if (historyMonths > 0) {
      let currentCycleStart = getCycleStart(cfg.cutoff_day, cfg.cutoff_time, now);
      for (let i = 1; i <= historyMonths; i++) {
        let prevCycleStart = new Date(currentCycleStart.getFullYear(), currentCycleStart.getMonth() - 1, cfg.cutoff_day, hours || 0, minutes || 0, 0, 0);
        let prevCycleEnd = new Date(currentCycleStart.getTime());

        const histUsage = await this._calculatePeriodBill(prevCycleStart, prevCycleEnd);
        
        // กรองแถวที่ยอดใช้ไฟและโซลาร์เป็น 0 ออก ไม่นำมาเก็บลงตาราง
        if (histUsage.totalUnits > 0 || histUsage.solarUnits > 0) {
          const monthLabel = `${prevCycleEnd.getFullYear()}-${String(prevCycleEnd.getMonth() + 1).padStart(2, '0')}`;
          historyRows.push({
            label: monthLabel,
            ...histUsage
          });
        }

        currentCycleStart = prevCycleStart;
      }
    }
    this._historyData = historyRows;
    this._render();
  }

  _calcBillFromUnits(units) {
    const cfg = this._config;
    const vat = cfg.vat;
    const ft = cfg.ft_baht != null ? cfg.ft_baht : FT_DEFAULT;
    const rateSet = cfg.rates.tiers ? cfg.rates : DEFAULT_RATES;
    
    const energyCharge = tieredEnergyCharge(units, rateSet.tiers);
    const serviceCharge = cfg.service_charge != null ? cfg.service_charge : DEFAULT_RATES.serviceCharge;
    
    const lines = [];
    lines.push({
      icon: "mdi:lightning-bolt",
      iconColor: "#ff9800",
      label: `ค่าพลังงานไฟฟ้า (${units.toFixed(2)} หน่วย)`,
      val: energyCharge
    });
    lines.push({
      icon: "mdi:wrench-clock",
      iconColor: "#78909c",
      label: "ค่าบริการรายเดือน",
      val: serviceCharge
    });

    const ftCharge = units * ft;
    lines.push({
      icon: "mdi:chart-timeline-variant",
      iconColor: "#29b6f6",
      label: `ค่า Ft (${ft.toFixed(4)} ฿/หน่วย)`,
      val: ftCharge
    });
    
    const subtotal = energyCharge + serviceCharge + ftCharge;
    const vatAmount = subtotal * (vat / 100);
    lines.push({
      icon: "mdi:percent",
      iconColor: "#ab47bc",
      label: `ภาษีมูลค่าเพิ่ม VAT (${vat}%)`,
      val: vatAmount
    });
    const total = subtotal + vatAmount;

    return { units, lines, total };
  }

  _calcBill() {
    const units = this._usage ? this._usage.netUnits : 0;
    return this._calcBillFromUnits(units);
  }

  _render() {
    if (!this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });

    const bill = this._calcBill();
    const period = this._period || "cycle";
    const cycleLabel = this._cycleStart
      ? `Since ${this._cycleStart.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`
      : "Loading usage…";

    const tabs = Object.entries(PERIODS)
      .map(
        ([key, def]) =>
          `<button class="tab${key === period ? " active" : ""}" data-period="${key}">${def.label}</button>`
      )
      .join("");

    const rows = bill.lines
      .map(
        (item) => `
          <tr>
            <td>
              <div class="row-label">
                <ha-icon icon="${item.icon}" style="color: ${item.iconColor};"></ha-icon>
                <span>${item.label}</span>
              </div>
            </td>
            <td class="num">${item.val.toFixed(2)} ฿</td>
          </tr>
        `
      )
      .join("");

    const totalU = this._usage ? this._usage.totalUnits.toFixed(2) : "0.00";
    const solarU = this._usage ? this._usage.solarUnits.toFixed(2) : "0.00";
    const netU = this._usage ? this._usage.netUnits.toFixed(2) : "0.00";

    const now = new Date();
    const currentMonthLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const historyRowsHtml = (this._historyData || []).map(row => `
      <tr>
        <td><b>${row.label}</b></td>
        <td class="num">${row.totalUnits.toFixed(2)} <small>kWh</small></td>
        <td class="num"><span class="solar-txt">-${row.solarUnits.toFixed(2)}</span> <small>kWh</small></td>
        <td class="num hist-cost">${row.cost.toFixed(2)} <small>฿</small></td>
      </tr>
    `).join('');

    this.shadowRoot.innerHTML = `
      <style>
        ha-card {
          padding: 16px;
          font-family: var(--paper-font-body1_-_font-family, inherit);
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 12px;
        }
        .title {
          font-size: 1.15em;
          font-weight: 600;
          color: var(--primary-text-color);
        }
        .cycle {
          font-size: 0.85em;
          color: var(--secondary-text-color);
          margin-top: 2px;
        }
        .scheme-badge {
          font-size: 0.75em;
          font-weight: 500;
          background: var(--primary-color, #0288d1);
          color: var(--text-primary-color, #fff);
          border-radius: 6px;
          padding: 3px 8px;
          letter-spacing: 0.3px;
        }
        .tabs {
          display: flex;
          gap: 6px;
          margin-bottom: 14px;
        }
        .tab {
          flex: 1;
          padding: 6px 0;
          border: none;
          border-radius: 6px;
          background: var(--secondary-background-color, rgba(125, 125, 125, 0.12));
          color: var(--secondary-text-color);
          font-size: 0.85em;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .tab.active {
          background: var(--primary-color, #0288d1);
          color: #ffffff;
        }

        /* Summary Box */
        .summary-box {
          background: var(--secondary-background-color, rgba(125, 125, 125, 0.08));
          border: 1px solid var(--divider-color, rgba(125, 125, 125, 0.2));
          border-radius: 10px;
          padding: 12px 14px;
          margin-bottom: 14px;
          font-size: 0.9em;
        }
        .summary-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 4px 0;
        }
        .summary-label {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: var(--primary-text-color);
        }
        .summary-label ha-icon {
          --mdc-icon-size: 18px;
        }
        .summary-row.net {
          font-weight: 600;
          border-top: 1px dashed var(--divider-color, rgba(125, 125, 125, 0.3));
          margin-top: 6px;
          padding-top: 8px;
          font-size: 0.98em;
        }
        .net-txt {
          color: var(--primary-color, #0288d1);
        }

        /* Breakdown Table */
        table.bill-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.9em;
        }
        table.bill-table td {
          padding: 6px 0;
        }
        .row-label {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--primary-text-color);
        }
        .row-label ha-icon {
          --mdc-icon-size: 17px;
        }
        td.num {
          text-align: right;
          color: var(--primary-text-color);
        }

        /* Total Highlight Row */
        .total-box {
          margin-top: 10px;
          background: linear-gradient(135deg, rgba(var(--rgb-primary-color, 2, 136, 209), 0.12), rgba(var(--rgb-primary-color, 2, 136, 209), 0.04));
          border: 1px solid rgba(var(--rgb-primary-color, 2, 136, 209), 0.3);
          border-radius: 8px;
          padding: 12px 14px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .total-title {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          font-size: 1.0em;
          color: var(--primary-color, #0288d1);
        }
        .total-title ha-icon {
          --mdc-icon-size: 22px;
          color: var(--primary-color, #0288d1);
        }
        .total-amount {
          font-size: 1.35em;
          font-weight: 700;
          color: var(--primary-color, #0288d1);
        }

        /* History Table */
        .history-section {
          margin-top: 18px;
          border-top: 1px solid var(--divider-color, rgba(125, 125, 125, 0.2));
          padding-top: 12px;
        }
        .history-title {
          font-weight: 600;
          font-size: 0.95em;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--primary-text-color);
        }
        .history-title ha-icon {
          --mdc-icon-size: 18px;
          color: var(--primary-color, #0288d1);
        }
        .history-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.88em;
        }
        .history-table th, .history-table td {
          padding: 6px 4px;
          border-bottom: 1px solid var(--divider-color, rgba(125, 125, 125, 0.15));
        }
        .history-table th {
          color: var(--secondary-text-color);
          font-weight: 500;
          text-align: left;
        }
        .history-table th.num { text-align: right; }
        .th-wrap {
          display: inline-flex;
          align-items: center;
          gap: 3px;
        }
        .th-wrap ha-icon {
          --mdc-icon-size: 15px;
        }
        tr.current-row {
          background-color: var(--secondary-background-color, rgba(125, 125, 125, 0.1));
          font-weight: 500;
        }
        .badge-live {
          font-size: 0.68em;
          background: var(--primary-color, #0288d1);
          color: #fff;
          padding: 1px 5px;
          border-radius: 4px;
          margin-left: 4px;
          vertical-align: middle;
        }
        .solar-txt { color: #2e7d32; font-weight: 500; }
        .hist-cost { font-weight: 600; color: var(--primary-color, #0288d1); }
      </style>

      <ha-card>
        <div class="header">
          <div>
            <div class="title">${this._config.name}</div>
            <div class="cycle">${cycleLabel}</div>
          </div>
          <span class="scheme-badge">MEA 1.2</span>
        </div>

        <div class="tabs">${tabs}</div>

        <div class="summary-box">
          <div class="summary-row">
            <span class="summary-label">
              <ha-icon icon="mdi:transmission-tower" style="color: #ff9800;"></ha-icon>
              <span>พลังงานไฟฟ้าที่ใช้ทั้งหมด:</span>
            </span>
            <span><b>${totalU}</b> <small>kWh</small></span>
          </div>
          <div class="summary-row">
            <span class="summary-label">
              <ha-icon icon="mdi:solar-power" style="color: #4caf50;"></ha-icon>
              <span>พลังงานจาก Solar Cell:</span>
            </span>
            <span class="solar-txt">-${solarU} <small>kWh</small></span>
          </div>
          <div class="summary-row net">
            <span class="summary-label net-txt">
              <ha-icon icon="mdi:scale-balance" style="color: var(--primary-color, #0288d1);"></ha-icon>
              <span>หน่วยไฟฟ้าคงเหลือคิดเงิน:</span>
            </span>
            <span class="net-txt"><b>${netU}</b> <small>kWh</small></span>
          </div>
        </div>

        <table class="bill-table">
          <tbody>
            ${rows}
          </tbody>
        </table>

        <div class="total-box">
          <div class="total-title">
            <ha-icon icon="mdi:cash-multiple"></ha-icon>
            <span>ค่าไฟรวม(Total) </span>
          </div>
          <div class="total-amount">${bill.total.toFixed(2)} <small style="font-size: 0.65em;">฿</small></div>
        </div>

        ${this._config.history_months > 0 ? `
          <div class="history-section">
            <div class="history-title">
              <ha-icon icon="mdi:history"></ha-icon>
              <span>สถิติค่าไฟฟ้าย้อนหลังตามรอบบิล</span>
            </div>
            <table class="history-table">
              <thead>
                <tr>
                  <th>รอบบิล</th>
                  <th class="num">
                    <span class="th-wrap">
                      <ha-icon icon="mdi:transmission-tower" style="color: #ff9800;"></ha-icon>
                      <span>ใช้ไฟ</span>
                    </span>
                  </th>
                  <th class="num">
                    <span class="th-wrap">
                      <ha-icon icon="mdi:solar-power" style="color: #4caf50;"></ha-icon>
                      <span>Solar</span>
                    </span>
                  </th>
                  <th class="num">
                    <span class="th-wrap">
                      <ha-icon icon="mdi:cash-multiple" style="color: var(--primary-color, #0288d1);"></ha-icon>
                      <span>ค่าไฟ</span>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr class="current-row">
                  <td><b>${currentMonthLabel}</b><span class="badge-live">สด</span></td>
                  <td class="num">${totalU} <small>kWh</small></td>
                  <td class="num"><span class="solar-txt">-${solarU}</span> <small>kWh</small></td>
                  <td class="num hist-cost">${bill.total.toFixed(2)} <small>฿</small></td>
                </tr>
                ${historyRowsHtml}
              </tbody>
            </table>
          </div>
        ` : ''}
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
          <label>Bill Cutoff Time (HH:MM)</label>
          <input id="cutoff_time" type="time" value="${cfg.cutoff_time || '09:00'}" />
        </div>
      </div>
      <div class="two-col">
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
        <div class="row">
          <label>จำนวนรอบบิลย้อนหลัง (History Months)</label>
          <select id="history_months">
            <option value="0" ${cfg.history_months === 0 ? "selected" : ""}>ไม่แสดงประวัติ</option>
            <option value="3" ${cfg.history_months === 3 ? "selected" : ""}>ย้อนหลัง 3 เดือน</option>
            <option value="6" ${cfg.history_months === 6 ? "selected" : ""}>ย้อนหลัง 6 เดือน</option>
            <option value="12" ${cfg.history_months === 12 ? "selected" : ""}>ย้อนหลัง 12 เดือน (1 ปี)</option>
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
    $("cutoff_time").addEventListener("change", (e) => this._valueChanged("cutoff_time", e.target.value));
    $("default_period").addEventListener("change", (e) => this._valueChanged("default_period", e.target.value));
    $("history_months").addEventListener("change", (e) => this._valueChanged("history_months", Number(e.target.value)));
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
  description: "Calculate MEA residential electric bill with Solar deduction and history table.",
});
