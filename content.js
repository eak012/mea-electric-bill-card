(function () {
  const currentUrl = window.location.href;

  // ==========================================
  // ส่วนที่ 1: ทำงานเฉพาะหน้าดาวน์โหลด (downloadnew.php)
  // ==========================================
  if (currentUrl.includes("downloadnew.php")) {
    if (sessionStorage.getItem("bb_clicked") === currentUrl) return;

    let clicked = false;

    function checkAndClick() {
      const btn = document.getElementById("bbDlBtn");

      if (btn && !btn.classList.contains("bb-disabled") && !clicked) {
        clicked = true;
        sessionStorage.setItem("bb_clicked", currentUrl);

        btn.click();
        console.log("Auto-clicked download inside iframe.");

        // ส่งสัญญาณกลับไปให้หน้าหลักลบ iframe ตัวนี้
        window.parent.postMessage({
          action: "bb_download_done",
          frameId: window.name
        }, "*");

        // ถ้าเปิดแท็บแยกธรรมดา ให้ปิดหน้าต่างตามปกติ
        if (window.self === window.top) {
          setTimeout(() => {
            window.close();
          }, 1500);
        }

        return true;
      }
      return false;
    }

    const observer = new MutationObserver(() => {
      if (checkAndClick()) {
        observer.disconnect();
      }
    });

    observer.observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ["class"]
    });

    const timer = setInterval(() => {
      if (checkAndClick()) {
        clearInterval(timer);
      }
    }, 500);

    return; // จบการทำงานของหน้าดาวน์โหลด
  }

  // ==========================================
  // ส่วนที่ 2: ทำงานเฉพาะหน้าตารางรายการ (viewno18sbx / viewbrsb)
  // ==========================================
  const STORAGE_KEY = "bb_downloaded_ids";

  function getDownloadedList() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function markAsDownloaded(id) {
    if (!id) return;
    const list = getDownloadedList();
    if (!list.includes(id)) {
      list.push(id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }
  }

  // รับสัญญาณเคลียร์ iframe เมื่อดาวน์โหลดเสร็จ
  window.addEventListener("message", (event) => {
    if (event.data && event.data.action === "bb_download_done") {
      const frameToRemove = document.getElementById(event.data.frameId);
      if (frameToRemove) {
        setTimeout(() => {
          frameToRemove.remove();
        }, 3000);
      }
    }
  });

  // ซ่อนปุ่ม VIP และ บุ๊กมาร์ก ด้วย CSS
  const hideStyle = document.createElement("style");
  hideStyle.textContent = `
    a[href*="bookmarks.php"],
    a[href*="nDonatedN.php"],
    a[href*="donate"],
    a[href*="vip"] {
      display: none !important;
    }
  `;
  document.head.appendChild(hideStyle);

  // วนลูปหาแถวในตารางเพื่อใส่ปุ่ม "โหลด"
  const allRows = document.querySelectorAll("tr");
  const downloadedList = getDownloadedList();

  allRows.forEach((row) => {
    let imgBtn = null;
    row.querySelectorAll("a, button").forEach((el) => {
      if ((el.innerText || "").includes("รูป")) {
        imgBtn = el;
      }
    });

    if (!imgBtn) return;

    const cell = imgBtn.closest("td") || imgBtn.parentNode;
    if (!cell) return;

    const link = cell.querySelector('a[href*="details.php?id="]');
    if (!link) return;

    const idMatch = link.href.match(/id=(\d+)/);
    const torrentId = idMatch ? idMatch[1] : null;

    // ซ่อนปุ่ม VIP และ บุ๊กมาร์ก เพิ่มเติมในระดับ DOM
    cell.querySelectorAll("a, button").forEach((el) => {
      const text = el.innerText || "";
      if (
        text.includes("VIP") ||
        text.includes("บุ๊กมาร์ก") ||
        text.includes("บุ๊คมาร์ก") ||
        el.href.includes("bookmarks.php")
      ) {
        el.style.display = "none";
      }
    });

    if (cell.querySelector(".bb-quick-dl")) return;

    const isAlreadyDownloaded = torrentId && downloadedList.includes(torrentId);

    const dlBtn = document.createElement("a");
    dlBtn.className = "bb-quick-dl";
    dlBtn.setAttribute("data-id", torrentId || "");
    dlBtn.href = "javascript:void(0);";

    function setBtnStyle(downloaded) {
      if (downloaded) {
        dlBtn.innerText = "✔ โหลดแล้ว";
        dlBtn.title = "คุณเคยดาวน์โหลดไฟล์นี้ไปแล้ว (คลิกเพื่อโหลดซ้ำได้)";
        dlBtn.style.background = "#6b7280";
      } else {
        dlBtn.innerText = "⬇ โหลด";
        dlBtn.title = "ดาวน์โหลดไฟล์ .torrent ทันที";
        dlBtn.style.background = "#16a34a";
      }
    }

    dlBtn.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-left: 6px;
      padding: 4px 12px;
      font-size: 13px;
      font-weight: bold;
      color: #fff;
      border-radius: 6px;
      text-decoration: none;
      vertical-align: middle;
      cursor: pointer;
      line-height: 1.5;
      box-shadow: 0 1px 2px rgba(0,0,0,0.1);
      transition: background 0.2s;
    `;

    setBtnStyle(isAlreadyDownloaded);

    dlBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (dlBtn.getAttribute("data-loading") === "true") return;
      dlBtn.setAttribute("data-loading", "true");

      dlBtn.innerText = "⏳ ดึงลิงก์...";
      dlBtn.style.background = "#ca8a04";

      try {
        const res = await fetch(link.href);
        const buffer = await res.arrayBuffer();
        const decoder = new TextDecoder("windows-874");
        const htmlText = decoder.decode(buffer);

        // ตรวจสอบกรณีมีข้อความใหม่ค้างในกล่องจดหมาย
        if (
          htmlText.includes("คุณมีข้อความใหม่") ||
          htmlText.includes("กรุณาอ่านข้อความ") ||
          (htmlText.includes("messages.php") && htmlText.includes("ยังไม่ได้อ่าน"))
        ) {
          dlBtn.innerText = "✉ มีจดหมายค้าง";
          dlBtn.style.background = "#e11d48";
          dlBtn.title = "มีข้อความใหม่ยังไม่ได้อ่าน คลิกเพื่อเปิดกล่องจดหมาย";

          if (confirm("มีจดหมายใหม่ค้างอยู่ที่ยังไม่ได้อ่าน ทำให้เว็บไม่อนุญาตให้โหลดไฟล์\nต้องการเปิดไปหน้ากล่องจดหมายเพื่ออ่านทันทีหรือไม่?")) {
            window.open(`${window.location.origin}/messages.php`, "_blank");
          }

          dlBtn.removeAttribute("data-loading");
          setTimeout(() => {
            setBtnStyle(torrentId && getDownloadedList().includes(torrentId));
          }, 4000);
          return;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, "text/html");
        const targetDl = doc.querySelector('a[href*="downloadnew.php?id="]');

        const dlBtnOnPage = doc.querySelector('a[href*="downloadnew.php"]');
        const btnText = dlBtnOnPage ? (dlBtnOnPage.innerText || dlBtnOnPage.textContent || "") : "";
        if (btnText.includes("เคยโหลดแล้ว") && torrentId) {
          markAsDownloaded(torrentId);
        }

        if (targetDl && targetDl.href) {
          dlBtn.innerText = "⏳ รอ 5 วิ...";
          dlBtn.style.background = "#2563eb";

          const uniqueFrameId = "bb_frame_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

          const iframe = document.createElement("iframe");
          iframe.id = uniqueFrameId;
          iframe.name = uniqueFrameId;
          iframe.src = targetDl.href;
          iframe.style.display = "none";
          document.body.appendChild(iframe);

          let count = 5;
          const countTimer = setInterval(() => {
            count--;
            if (count > 0) {
              dlBtn.innerText = `⏳ รอ ${count} วิ...`;
            } else {
              clearInterval(countTimer);
              if (torrentId) markAsDownloaded(torrentId);

              dlBtn.innerText = "✅ สำเร็จ";
              dlBtn.style.background = "#16a34a";
              dlBtn.removeAttribute("data-loading");

              setTimeout(() => {
                setBtnStyle(true);
              }, 2000);
            }
          }, 1000);

        } else {
          if (doc.querySelector('a[href*="messages.php"]')) {
            alert("ไม่สามารถดาวน์โหลดได้เนื่องจากมีข้อความใหม่ กรุณาเปิดอ่านจดหมายในกล่องข้อความก่อนครับ");
          } else {
            alert("ไม่พบลิงก์ดาวน์โหลดในหน้ารายละเอียด");
          }
          dlBtn.innerText = "❌ ล้มเหลว";
          dlBtn.style.background = "#dc2626";
          dlBtn.removeAttribute("data-loading");
          setTimeout(() => {
            setBtnStyle(torrentId && getDownloadedList().includes(torrentId));
          }, 3000);
        }
      } catch (err) {
        console.error(err);
        dlBtn.innerText = "❌ ผิดพลาด";
        dlBtn.style.background = "#dc2626";
        dlBtn.removeAttribute("data-loading");
        setTimeout(() => {
          setBtnStyle(torrentId && getDownloadedList().includes(torrentId));
        }, 3000);
      }
    });

    imgBtn.parentNode.insertBefore(dlBtn, imgBtn.nextSibling);
  });

  // สร้างปุ่มลอย "🔄 ตรวจเช็คประวัติหน้านี้"
  if (!document.getElementById("bb_sync_btn")) {
    const syncBtn = document.createElement("button");
    syncBtn.id = "bb_sync_btn";
    syncBtn.innerHTML = "🔄 ตรวจเช็คประวัติหน้านี้";
    syncBtn.title = "กดเพื่อสแกนว่าเรื่องไหนในหน้านี้เคยดาวน์โหลดไปแล้วบ้าง";
    syncBtn.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 24px;
      z-index: 99999;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: bold;
      color: #ffffff;
      background: #2563eb;
      border: none;
      border-radius: 50px;
      box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);
      cursor: pointer;
      transition: all 0.2s ease;
    `;

    syncBtn.onmouseover = () => {
      syncBtn.style.background = "#1d4ed8";
      syncBtn.style.transform = "translateY(-2px)";
    };
    syncBtn.onmouseout = () => {
      syncBtn.style.background = "#2563eb";
      syncBtn.style.transform = "translateY(0)";
    };

    syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      syncBtn.style.background = "#ca8a04";
      syncBtn.innerHTML = "⏳ กำลังเริ่มสแกน...";

      localStorage.removeItem(STORAGE_KEY);

      const btns = Array.from(document.querySelectorAll(".bb-quick-dl"));
      let foundCount = 0;
      let processed = 0;
      const decoder = new TextDecoder("windows-874");

      for (const b of btns) {
        const id = b.getAttribute("data-id");
        processed++;
        syncBtn.innerHTML = `⏳ สแกน (${processed}/${btns.length})...`;

        b.innerText = "⬇ โหลด";
        b.style.background = "#16a34a";
        b.title = "ดาวน์โหลดไฟล์ .torrent ทันที";

        if (id) {
          try {
            const targetUrl = `${window.location.origin}/details.php?id=${id}`;
            const res = await fetch(targetUrl);
            const buffer = await res.arrayBuffer();
            const text = decoder.decode(buffer);

            const parser = new DOMParser();
            const doc = parser.parseFromString(text, "text/html");

            const dlBtnOnPage = doc.querySelector('a[href*="downloadnew.php"]');
            const btnText = dlBtnOnPage ? (dlBtnOnPage.innerText || dlBtnOnPage.textContent || "") : "";

            if (btnText.includes("เคยโหลดแล้ว")) {
              markAsDownloaded(id);
              b.innerText = "✔ โหลดแล้ว";
              b.title = "คุณเคยดาวน์โหลดไฟล์นี้ไปแล้ว (คลิกเพื่อโหลดซ้ำได้)";
              b.style.background = "#6b7280";
              foundCount++;
            }
          } catch (err) {
            console.error("Sync error for ID:", id, err);
          }
          await new Promise((r) => setTimeout(r, 120));
        }
      }

      syncBtn.style.background = "#16a34a";
      syncBtn.innerHTML = `✅ พบเคยโหลด ${foundCount} เรื่อง`;

      setTimeout(() => {
        syncBtn.style.background = "#2563eb";
        syncBtn.innerHTML = "🔄 ตรวจเช็คประวัติหน้านี้";
        syncBtn.disabled = false;
      }, 3500);
    });

    document.body.appendChild(syncBtn);
  }
})();