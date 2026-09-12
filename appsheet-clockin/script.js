const APP_ID = "7fe1d313-5e1e-468c-a00c-ee4520220e6f"; 
const ACCESS_KEY = "V2-ELkR9-BwKCI-IADhC-RM9cz-svgHf-WYbl4-Zlzzs-z7ahB"; 

let employeeMap = new Map();

// จับคู่แถวข้อมูล (เข้างาน/ออกงาน/ลางาน) กับพนักงานใน employeeMap
// ต้องเรียก fetchEmployeesFromSheet() ให้ employeeMap มีข้อมูลก่อนเรียกใช้ฟังก์ชันนี้
// รองรับ 2 กรณี:
//  1) ข้อมูลใหม่ (หลังแก้ปัญหา Ref): ค่าที่เก็บคือ ID ตัวเลขล้วนๆ ของพนักงาน
//  2) ข้อมูลเก่า (ก่อนแก้ไข): ค่าที่เก็บเป็นชื่อ/รูปแบบ "ID.ชื่อ" แบบข้อความ
function findEmployeeByRow(row) {
  const rawVal = getRowValue(row, ['NAME', 'Name', 'name', 'รายชื่อ', 'พนักงาน', 'ชื่อ', 'ชื่อ-นามสกุล', 'ชื่อพนักงาน']);
  const rawStr = String(rawVal).trim();

  if (/^\d+$/.test(rawStr) && employeeMap.has(rawStr)) {
    return employeeMap.get(rawStr);
  }

  const rowName = normalizeEmpName(rawStr);
  const rowPureName = getPureName(rowName);

  for (let emp of employeeMap.values()) {
    if (emp.pureName && rowPureName && emp.pureName === rowPureName) return emp;
  }
  for (let emp of employeeMap.values()) {
    if (emp.name === rowName) return emp;
  }
  return null;
}

function normalizeEmpName(nameStr) {
  if (!nameStr) return "";
  let clean = String(nameStr).trim();

  // แผนที่แก้ไขชื่อที่สะกดไม่ตรงกันระหว่างตาราง "รายชื่อ" กับตารางธุรกรรม (พบจากข้อมูลจริง)
  // key = สะกดที่พบในข้อมูล, value = สะกดที่ถูกต้อง/ใช้เป็นมาตรฐาน
  const typoMap = {
    "ลูกเกต": "ลูกเกด",
    "ชิน": "ซิน"   // ตาราง "รายชื่อ" สะกดว่า "ซิน" (ซ) แต่ตาราง เข้างาน/ออกงาน/ลางาน บางแถวสะกดว่า "ชิน" (ช)
  };

  Object.keys(typoMap).forEach(wrong => {
    // จับเฉพาะกรณีที่เป็น "ชื่อทั้งคำ" เท่านั้น (มีเลขนำหน้าได้ เช่น "5.ลูกเกต")
    // เพื่อไม่ให้ไปแก้คำที่บังเอิญมีตัวอักษรเหล่านี้ปนอยู่ในชื่ออื่น
    const re = new RegExp(`^(\\d+\\.\\s*)?${wrong}$`);
    if (re.test(clean)) {
      clean = clean.replace(wrong, typoMap[wrong]);
    }
  });

  return clean;
}

function getPureName(nameStr) {
  if (!nameStr) return "";
  const clean = normalizeEmpName(nameStr);
  return clean.replace(/^\d+\.\s*/, '').trim();
}

const getSortIndex = (emp) => {
  const parsedId = parseInt(emp.id, 10);
  if (!isNaN(parsedId)) return parsedId;
  const match = String(emp.name).match(/^(\d+)\./);
  return match ? parseInt(match[1], 10) : 999;
};

const getRowValue = (row, keys) => {
  if (!row) return '';
  for (let key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return '';
};

// ป้องกัน XSS: แปลงอักขระพิเศษของ HTML ให้เป็น entity ก่อนแทรกลงใน innerHTML
// ใช้กับข้อมูลทุกจุดที่มาจากผู้ใช้/ชีต (ชื่อ, วันที่, เวลา, ตำแหน่ง ฯลฯ)
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================
// ดึงข้อมูลจากตาราง AppSheet
// AppSheet Data API ของโปรเจกต์นี้คืนข้อมูลครบในคำขอเดียวอยู่แล้ว
// การวนแบ่งหน้าทำให้คำขอเดิมถูกทำซ้ำและนับข้อมูลซ้ำหลายรอบ
// ==========================================
async function fetchTableData(tableName) {
  try {
    const res = await fetch(`https://api.appsheet.com/api/v2/apps/${APP_ID}/tables/${tableName}/Action`, {
      method: "POST",
      headers: { "ApplicationAccessKey": ACCESS_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        "Action": "Find",
        "Properties": { "Locale": "th-TH" },
        "Selector": "",
        "Rows": []
      })
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`AppSheet request failed for ${tableName} (${res.status}): ${errorBody}`);
    }

    const data = await res.json();
    return Array.isArray(data) ? data : (data.Rows || []);
  } catch (e) {
    console.warn(`ไม่สามารถดึงข้อมูลจากตาราง ${tableName} ได้:`, e);
    throw e;
  }
}

// ==========================================
// แก้ไข: รองรับชื่อคอลัมน์ภาษาไทยของตาราง "รายชื่อ" ด้วย
// (ก่อนหน้านี้มองหาแค่ NAME/Name/name ทำให้ถ้าคอลัมน์เป็นภาษาไทย
//  เช่น "ชื่อ-นามสกุล" จะดึงชื่อพนักงานไม่ได้เลย และรายงานเลยแสดงชื่อไม่ครบ)
// ==========================================
async function fetchEmployeesFromSheet() {
  try {
    const rows = await fetchTableData('รายชื่อ');
    employeeMap.clear();

    if (rows && rows.length > 0) {
      rows.forEach((r, index) => {
        const rawId = getRowValue(r, ['ID', 'id', '_RowNumber', 'รหัส', 'ลำดับ']);
        const rawNameStr = getRowValue(r, [
          'NAME', 'Name', 'name',
          'รายชื่อ', 'พนักงาน', 'ชื่อ', 'ชื่อ-นามสกุล', 'ชื่อพนักงาน'
        ]);

        const name = normalizeEmpName(rawNameStr);

        if (name) {
          // ใช้ prefix "row-" กัน id ชนกับ ID จริงที่อาจเป็นตัวเลขซ้ำกับ index
          const id = String(rawId || `row-${index + 1}`).trim();
          employeeMap.set(id, { 
            id: id, 
            name: name, 
            rawName: String(rawNameStr).trim(), // ชื่อดิบ ไม่ผ่านการแก้ typo — ใช้สร้าง Key ตอน submit ให้ตรงกับ AppSheet เป๊ะ
            pureName: getPureName(name) 
          });
        }
      });
    }
  } catch (e) {
    console.warn("ไม่สามารถดึงรายชื่อพนักงานจาก AppSheet ได้:", e);
  }
}

function openModal() {
  document.getElementById('formModal').style.display = 'flex';
  const statusDiv = document.getElementById('status');
  if (statusDiv) statusDiv.style.display = 'none';
  if (document.getElementById('locationCoords')) {
    fetchLocation();
  }
}

function closeModal() {
  document.getElementById('formModal').style.display = 'none';
  const empSelect = document.getElementById('employeeName');
  if (empSelect) empSelect.value = '';
}

function getLocalDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initFormDateTime(dateId, timeId) {
  const now = new Date();
  // ใช้วันที่ตามเวลาท้องถิ่น เพื่อไม่ให้วันที่เลื่อนในช่วงหลังเที่ยงคืน
  document.getElementById(dateId).value = getLocalDateInputValue(now);
  document.getElementById(timeId).value = now.toTimeString().split(' ')[0].substring(0, 8);
}

function fetchLocation() {
  const locInput = document.getElementById('locationCoords');
  if (!locInput) return;

  locInput.value = "กำลังค้นหาตำแหน่ง...";

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locInput.value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
      },
      (error) => {
        locInput.value = "";
        alert("ไม่สามารถดึงตำแหน่ง GPS ได้ กรุณาเปิดสิทธิ์การใช้งานตำแหน่งบนเบราว์เซอร์");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  } else {
    locInput.value = "";
    alert("อุปกรณ์ไม่รองรับ GPS");
  }
}

function getValidLocation() {
  const locElem = document.getElementById('locationCoords');
  const locVal = locElem ? locElem.value : "";
  if (locVal.includes(',')) {
    return locVal;
  }
  return ""; 
}

async function loadEmployees() {
  const select = document.getElementById('employeeName');
  if (!select) return;
  
  select.innerHTML = '<option value="">-- กำลังโหลดรายชื่อ... --</option>';
  await fetchEmployeesFromSheet();
  select.innerHTML = '<option value="">-- เลือกรายชื่อ --</option>';

  const empList = Array.from(employeeMap.values());
  empList.sort((a, b) => getSortIndex(a) - getSortIndex(b));

  empList.forEach(emp => {
    const opt = document.createElement('option');
    opt.value = emp.id;
    opt.textContent = emp.name;
    opt.dataset.name = emp.name;
    opt.dataset.rawName = emp.rawName;
    opt.dataset.id = emp.id;
    select.appendChild(opt);
  });
}

function parseThaiMonth(monthStr) {
  if (!monthStr) return null;
  const thaiMonths = {
    "ม.ค.": 1, "มกราคม": 1, "ก.พ.": 2, "กุมภาพันธ์": 2,
    "มี.ค.": 3, "มีนาคม": 3, "เม.ย.": 4, "เมษายน": 4,
    "พ.ค.": 5, "พฤษภาคม": 5, "มิ.ย.": 6, "มิถุนายน": 6,
    "ก.ค.": 7, "กรกฎาคม": 7, "ส.ค.": 8, "สิงหาคม": 8,
    "ก.ย.": 9, "กันยายน": 9, "ต.ค.": 10, "ตุลาคม": 10,
    "พ.ย.": 11, "พฤศจิกายน": 11, "ธ.ค.": 12, "ธันวาคม": 12
  };
  return thaiMonths[monthStr.trim()] || null;
}

// แปลงวันที่ (รองรับทั้งรูปแบบไทย เช่น "5 ก.ย. 2569" และรูปแบบเลข เช่น "05/09/2569")
// คืนค่าเป็น { y, m, d } แบบปี ค.ศ. เสมอ หรือ null ถ้าแปลงไม่ได้
// ใช้ร่วมกันทั้งหน้ารายงานรายเดือนและหน้า Dashboard เพื่อไม่ให้ logic การแปลงวันที่เพี้ยนไปคนละแบบ
function normalizeCalendarYear(year) {
  if (Number.isNaN(year)) return null;
  if (year > 2400) return year - 543; // พ.ศ. -> ค.ศ.

  // ข้อมูลเดิมบางรายการถูกตีความปี ค.ศ. เป็น พ.ศ. ตอนส่ง API
  // เช่น 2026 ถูกเก็บเป็น 1483 (2026 - 543) จึงแปลงกลับเพื่อให้อ่านและนับได้ถูกต้อง
  if (year >= 1400 && year < 1900) return year + 543;
  return year;
}

function parseDateToYMD(rawDateStr) {
  if (!rawDateStr || rawDateStr === '-') return null;
  const str = String(rawDateStr).trim();
  if (!str) return null;

  const thaiTextParts = str.split(/\s+/);
  if (thaiTextParts.length >= 3) {
    const d = parseInt(thaiTextParts[0], 10);
    const m = parseThaiMonth(thaiTextParts[1]);
    const y = normalizeCalendarYear(parseInt(thaiTextParts[2], 10));
    if (!isNaN(d) && m && !isNaN(y)) {
      return { y, m, d };
    }
  }

  const cleanStr = str.split(' ')[0];
  const parts = cleanStr.split(/[\/\-\.]/);
  if (parts.length === 3) {
    let p0 = parseInt(parts[0], 10);
    let p1 = parseInt(parts[1], 10);
    let p2 = parseInt(parts[2], 10);
    p0 = normalizeCalendarYear(p0);
    p2 = normalizeCalendarYear(p2);

    let y, m, d;
    if (parts[0].length === 4) {
      y = p0; m = p1; d = p2;
    } else if (parts[2].length === 4) {
      // AppSheet API ส่งวันที่ตัวเลขในรูปแบบ MM/DD/YYYY
      y = p2; m = p0; d = p1;
    }
    if (y && m && d && !isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return { y, m, d };
    }
  }
  return null;
}

function formatThaiDateShort(dateStr) {
  if (!dateStr || dateStr === '-') return '-';
  const thaiMonthsShort = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const parsed = parseDateToYMD(dateStr);
  if (!parsed || parsed.m < 1 || parsed.m > 12) return dateStr;
  return `${parsed.d} ${thaiMonthsShort[parsed.m - 1]} ${parsed.y + 543}`;
}

let isSubmitting = false;

function createRecordId() {
  // ใช้ UUID ลดโอกาส ID ชนกันระหว่างผู้ใช้หลายคนหรือหลายแท็บ
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `ID-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function postToAppSheet(tableName, rowData) {
  if (isSubmitting) return; // กันกดซ้ำระหว่างกำลังบันทึกอยู่
  isSubmitting = true;

  const statusDiv = document.getElementById('status');
  if (statusDiv) {
    statusDiv.style.display = 'block'; 
    statusDiv.style.color = '#1976d2';
    statusDiv.innerText = "กำลังบันทึก...";
  }

  try {
    const res = await fetch(`https://api.appsheet.com/api/v2/apps/${APP_ID}/tables/${tableName}/Action`, {
      method: "POST",
      headers: { "ApplicationAccessKey": ACCESS_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        "Action": "Add",
        // วันที่จาก input เป็นรูปแบบ ISO ค.ศ. จึงระบุ locale ที่ไม่แปลงปีเป็น พ.ศ.
        "Properties": { "Locale": "en-US", "Timezone": "SE Asia Standard Time" },
        "Rows": [ rowData ]
      })
    });

    if (res.ok) {
      if (statusDiv) {
        statusDiv.style.color = '#2e7d32';
        statusDiv.innerText = "บันทึกสำเร็จ!";
      }
      setTimeout(() => {
        closeModal();
        loadHistoryTable(tableName);
      }, 1000);
    } else {
      const err = await res.json().catch(() => ({}));
      if (statusDiv) {
        statusDiv.style.color = '#d32f2f';
        statusDiv.innerText = `บันทึกไม่สำเร็จ: ${err.detail || 'ข้อผิดพลาด API'}`;
      }
    }
  } catch (e) {
    if (statusDiv) {
      statusDiv.style.color = '#d32f2f'; 
      statusDiv.innerText = "เกิดข้อผิดพลาดในการเชื่อมต่อ";
    }
  } finally {
    isSubmitting = false;
  }
}

function getSelectedEmployeeInfo() {
  const select = document.getElementById('employeeName');
  if (!select || !select.value) return null;
  
  const selectedOpt = select.options[select.selectedIndex];
  const id = selectedOpt.value;
  const name = selectedOpt.dataset.name || selectedOpt.textContent;

  return {
    id: id,
    name: name,
    // ค่าที่ต้องส่งให้ AppSheet field ประเภท Ref: ต้องตรงกับ Key ของตาราง "รายชื่อ" ซึ่งคือคอลัมน์ ID (Number)
    // (ไม่ใช่ชื่อหรือ "ID.ชื่อ" อย่างที่เคยลองมาก่อน — เช็คจาก AppSheet Editor แล้วว่า Key คือ ID ล้วนๆ)
    refValue: /^\d+$/.test(id) ? Number(id) : id
  };
}

function submitCheckIn() {
  const emp = getSelectedEmployeeInfo();
  if (!emp) return alert("กรุณาเลือกรายชื่อพนักงาน");

  const dateVal = document.getElementById('checkInDate').value;
  const timeVal = document.getElementById('checkInTime').value;
  if (!dateVal || !timeVal) return alert("กรุณากรอกวันที่และเวลาให้ครบถ้วน");

  postToAppSheet('เข้างาน', {
    "ID": createRecordId(),
    "NAME": emp.refValue,
    "check-in": dateVal,
    "เวลา": timeVal,
    "Location": getValidLocation()
  });
}

function submitCheckOut() {
  const emp = getSelectedEmployeeInfo();
  if (!emp) return alert("กรุณาเลือกรายชื่อพนักงาน");

  const dateVal = document.getElementById('checkOutDate').value;
  const timeVal = document.getElementById('checkOutTime').value;
  if (!dateVal || !timeVal) return alert("กรุณากรอกวันที่และเวลาให้ครบถ้วน");

  postToAppSheet('ออกงาน', {
    "ID": createRecordId(),
    "NAME": emp.refValue,
    "check-out": dateVal,
    "เวลา": timeVal,
    "Location": getValidLocation()
  });
}

function submitLeave() {
  const emp = getSelectedEmployeeInfo();
  if (!emp) return alert("กรุณาเลือกรายชื่อพนักงาน");

  const dateVal = document.getElementById('leaveDate').value;
  if (!dateVal) return alert("กรุณาเลือกวันที่ลา");

  const selectedReason = document.querySelector('input[name="leaveReasonOption"]:checked');
  if (!selectedReason) return alert("กรุณาเลือกสาเหตุที่ลา");
  const leaveReasonValue = selectedReason.value;

  postToAppSheet('ลางาน', {
    "ID": createRecordId(),
    "NAME": emp.refValue,
    "วันที่": dateVal,
    "สาเหตุที่ลา": leaveReasonValue,
    "หมายเหตุ": document.getElementById('leaveNote') ? document.getElementById('leaveNote').value : ""
  });
}

async function loadHistoryTable(tableName) {
  const tbody = document.getElementById('logsTableBody');
  if (!tbody) return;
  
  const isLeaveTable = (tableName === 'ลางาน');
  const colCount = isLeaveTable ? 3 : 4;

  tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center; color:#888;">กำลังโหลด...</td></tr>`;
  
  try {
    if (employeeMap.size === 0) {
      await fetchEmployeesFromSheet();
    }
    const rows = await fetchTableData(tableName);

    tbody.innerHTML = '';
    if (!rows || rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center; color:#888;">ไม่มีข้อมูลรายการ "${tableName}"</td></tr>`;
      return;
    }

    rows.slice().reverse().forEach(r => {
      const tr = document.createElement('tr');
      // รองรับทั้งข้อมูลใหม่ (เก็บเป็น ID ตัวเลข) และข้อมูลเก่า (เก็บเป็นชื่อ) ผ่าน findEmployeeByRow
      const matchedEmp = findEmployeeByRow(r);
      const empName = matchedEmp
        ? matchedEmp.name
        : normalizeEmpName(getRowValue(r, ['NAME', 'Name', 'name', 'รายชื่อ', 'พนักงาน', 'ชื่อ', 'ชื่อ-นามสกุล', 'ชื่อพนักงาน', '-']));
      
      const rawDate = r['check-in'] || r['check-out'] || r['วันที่'] || '-';
      const dateVal = formatThaiDateShort(rawDate);
      
      const timeVal = r['เวลา'] || r['สาเหตุที่ลา'] || '-';
      const locationVal = r['Location'] || '-';

      let locationDisplay = '-';
      if (locationVal && locationVal.includes(',')) {
        const cleanLoc = locationVal.trim();
        locationDisplay = `<a href="https://maps.google.com/?q=${encodeURIComponent(cleanLoc)}" target="_blank" style="color:#1976d2; text-decoration:none; font-weight:bold;">📍 ดูแผนที่</a>`;
      } else if (locationVal && locationVal !== '-') {
        locationDisplay = escapeHtml(locationVal);
      }

      if (isLeaveTable) {
        tr.innerHTML = `<td><b>${escapeHtml(empName)}</b></td><td>${escapeHtml(dateVal)}</td><td>${escapeHtml(timeVal)}</td>`;
      } else {
        tr.innerHTML = `<td><b>${escapeHtml(empName)}</b></td><td>${escapeHtml(dateVal)}</td><td>${escapeHtml(timeVal)}</td><td>${locationDisplay}</td>`;
      }

      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center; color:red;">เกิดข้อผิดพลาดในการโหลดข้อมูล</td></tr>`;
  }
}

let isReportLoading = false;

async function generateMonthlyReport() {
  if (isReportLoading) return; // กันกดรัวจนยิง request ซ้อนกัน
  isReportLoading = true;

  const tbody = document.getElementById('reportTableBody');
  if (!tbody) { isReportLoading = false; return; }

  const monthInput = document.getElementById('reportMonth');
  if (!monthInput || !monthInput.value) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#888;">กรุณาเลือกเดือน/ปี ที่ต้องการดูรายงาน</td></tr>';
    isReportLoading = false;
    return;
  }

  const selectedMonth = monthInput.value; 
  const [targetYearStr, targetMonthStr] = selectedMonth.split('-');
  const targetYear = parseInt(targetYearStr, 10);
  const targetMonth = parseInt(targetMonthStr, 10);

  tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#888;">กำลังคำนวณรายงาน...</td></tr>';

  try {
    await fetchEmployeesFromSheet();

    const [checkInRows, checkOutRows, leaveRows] = await Promise.all([
      fetchTableData('เข้างาน').catch(() => []),
      fetchTableData('ออกงาน').catch(() => []),
      fetchTableData('ลางาน').catch(() => [])
    ]);

    const stats = {};

    employeeMap.forEach((emp, id) => {
      stats[id] = { name: emp.name, workDays: new Set(), leaveDays: new Set(), sortIndex: getSortIndex(emp) };
    });

    const findEmployeeId = (row) => {
      const emp = findEmployeeByRow(row);
      return emp ? emp.id : null;
    };

    const extractValidDate = (rawDateStr) => {
      const parsed = parseDateToYMD(rawDateStr);
      if (!parsed) return null;
      if (parsed.y === targetYear && parsed.m === targetMonth) {
        return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
      }
      return null;
    };

    const processWorkRows = (rows) => {
      if (!Array.isArray(rows)) return;
      rows.forEach(r => {
        const empId = findEmployeeId(r);
        const validDate = extractValidDate(getRowValue(r, ['check-in', 'check_in', 'check-out', 'check_out', 'วันที่', 'Date', 'DATE']));

        if (empId && stats[empId] && validDate) {
          stats[empId].workDays.add(validDate);
        }
      });
    };

    processWorkRows(checkInRows);
    processWorkRows(checkOutRows);

    if (Array.isArray(leaveRows)) {
      leaveRows.forEach(r => {
        const empId = findEmployeeId(r);
        const validDate = extractValidDate(getRowValue(r, ['วันที่', 'Date', 'DATE', 'leave_date', 'check-in']));

        if (empId && stats[empId] && validDate) {
          stats[empId].leaveDays.add(validDate);
        }
      });
    }

    Object.keys(stats).forEach(id => {
      const emp = stats[id];
      emp.workDays.forEach(date => {
        if (emp.leaveDays.has(date)) {
          emp.leaveDays.delete(date);
        }
      });
    });

    tbody.innerHTML = '';
    const sortedIds = Object.keys(stats).sort((a, b) => stats[a].sortIndex - stats[b].sortIndex);

    if (sortedIds.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#888;">ไม่พบข้อมูลพนักงาน</td></tr>';
      return;
    }

    sortedIds.forEach(id => {
      const item = stats[id];
      const workCount = item.workDays ? item.workDays.size : 0;
      const leaveCount = item.leaveDays ? item.leaveDays.size : 0;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><b>${escapeHtml(item.name)}</b></td>
        <td style="text-align: center;">
          ${workCount > 0 ? `<span class="badge-checkin">${workCount} วัน</span>` : `<span style="color:#ccc;">0 วัน</span>`}
        </td>
        <td style="text-align: center;">
          ${leaveCount > 0 ? `<span class="badge-leave">${leaveCount} วัน</span>` : `<span style="color:#ccc;">0 วัน</span>`}
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (e) {
    console.error("Monthly Report Error Detailed:", e);
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:red;">เกิดข้อผิดพลาดในการคำนวณรายงาน กรุณาลองใหม่อีกครั้ง</td></tr>';
  } finally {
    isReportLoading = false;
  }
}

// ==========================================
// Dashboard (หน้าแรก) — รวมมาจาก dashboard.js เดิม เพื่อใช้ normalizeEmpName/fetchTableData/
// escapeHtml ชุดเดียวกับหน้าอื่นทั้งหมด ป้องกันปัญหาแก้ไม่ครบทุกไฟล์แบบที่เคยเจอ
// ==========================================

function displayCurrentDate() {
  const dateBadge = document.getElementById('dashboard-date');
  if (!dateBadge) return;
  const now = new Date();
  const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  dateBadge.innerText = `📅 ${now.getDate()} ${thaiMonths[now.getMonth()]} ${now.getFullYear() + 543}`;
}

async function loadTodayDashboard() {
  const tbody = document.getElementById('today-logs-body');
  if (!tbody) return;

  const now = new Date();
  const todayY = now.getFullYear();
  const todayM = now.getMonth() + 1;
  const todayD = now.getDate();

  // เทียบวันที่แบบ y/m/d ที่แปลงแล้วเสมอ แทนการเทียบสตริงตรงๆ
  // (ของเดิมเทียบ string แบบ "2026-09-11" กับวันที่ในชีตที่จริงๆ เป็น "11 ก.ย. 2569"
  //  ทำให้ไม่มีทาง match ได้เลย ตัวเลขในการ์ดจึงติด 0 ตลอด)
  const isToday = (rawDateStr) => {
    const parsed = parseDateToYMD(rawDateStr);
    return !!parsed && parsed.y === todayY && parsed.m === todayM && parsed.d === todayD;
  };

  try {
    // โหลดรายชื่อก่อน เพื่อให้ Ref ที่ AppSheet ส่งกลับมาแปลงเป็นพนักงานคนเดิมได้ถูกต้อง
    if (employeeMap.size === 0) {
      await fetchEmployeesFromSheet();
    }

    const [checkIns, checkOuts, leaves] = await Promise.all([
      fetchTableData('เข้างาน'),
      fetchTableData('ออกงาน'),
      fetchTableData('ลางาน')
    ]);

    const todayCheckIns = checkIns.filter(r => isToday(getRowValue(r, ['check-in', 'วันที่'])));
    const todayCheckOuts = checkOuts.filter(r => isToday(getRowValue(r, ['check-out', 'วันที่'])));
    const todayLeaves = leaves.filter(r => isToday(getRowValue(r, ['วันที่'])));

    // หน้าสรุประบุหน่วยเป็น "คน" จึงนับพนักงานแบบไม่ซ้ำ แม้มีรายการซ้ำในวันเดียวกัน
    const getEmployeeKey = (row) => {
      const employee = findEmployeeByRow(row);
      if (employee) return employee.id;
      return String(getRowValue(row, ['NAME', 'Name', 'name'])).trim();
    };
    const uniqueRowsByEmployee = (rows) => {
      const uniqueRows = new Map();
      rows.forEach(row => {
        const key = getEmployeeKey(row);
        if (!key) return;
        const existing = uniqueRows.get(key);
        const candidateTime = String(getRowValue(row, ['เวลา']) || '');
        const existingTime = String(getRowValue(existing, ['เวลา']) || '');
        // หากลงรายการสถานะเดิมซ้ำในวันเดียวกัน ให้แสดงเวลาล่าสุด
        if (!existing || candidateTime >= existingTime) uniqueRows.set(key, row);
      });
      return [...uniqueRows.values()];
    };

    const uniqueCheckIns = uniqueRowsByEmployee(todayCheckIns);
    const uniqueCheckOuts = uniqueRowsByEmployee(todayCheckOuts);
    const uniqueLeaves = uniqueRowsByEmployee(todayLeaves);

    const checkinCountEl = document.getElementById('stat-checkin-count');
    const checkoutCountEl = document.getElementById('stat-checkout-count');
    const leaveCountEl = document.getElementById('stat-leave-count');
    if (checkinCountEl) checkinCountEl.innerText = `${uniqueCheckIns.length} คน`;
    if (checkoutCountEl) checkoutCountEl.innerText = `${uniqueCheckOuts.length} คน`;
    if (leaveCountEl) leaveCountEl.innerText = `${uniqueLeaves.length} คน`;

    // รองรับทั้งข้อมูลใหม่ (เก็บเป็น ID ตัวเลข) และข้อมูลเก่า (เก็บเป็นชื่อ) ผ่าน findEmployeeByRow
    const resolveName = (r) => {
      const emp = findEmployeeByRow(r);
      return emp ? emp.name : normalizeEmpName(getRowValue(r, ['NAME', 'Name', 'name', 'รายชื่อ', 'พนักงาน', 'ชื่อ', 'ชื่อ-นามสกุล', 'ชื่อพนักงาน']));
    };

    let logs = [];

    uniqueCheckIns.forEach(r => {
      logs.push({
        name: resolveName(r),
        statusHtml: '<span class="badge-checkin">📌 เข้างาน</span>',
        time: getRowValue(r, ['เวลา']) || '-'
      });
    });

    uniqueCheckOuts.forEach(r => {
      logs.push({
        name: resolveName(r),
        statusHtml: '<span class="badge-checkout">↔️ ออกงาน</span>',
        time: getRowValue(r, ['เวลา']) || '-'
      });
    });

    uniqueLeaves.forEach(r => {
      logs.push({
        name: resolveName(r),
        statusHtml: '<span class="badge-leave">✋ ลางาน</span>',
        time: getRowValue(r, ['สาเหตุที่ลา']) || 'ลางาน'
      });
    });

    tbody.innerHTML = '';
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#888;">วันนี้ยังไม่มีการลงเวลา</td></tr>';
      return;
    }

    logs.forEach(item => {
      const tr = document.createElement('tr');
      // statusHtml เป็น HTML คงที่ที่เราสร้างเอง (ไม่ได้มาจากผู้ใช้) จึงไม่ต้อง escape
      // แต่ name และ time มาจากข้อมูลในชีต ต้อง escape ป้องกัน XSS เสมอ
      tr.innerHTML = `
        <td><b>${escapeHtml(item.name)}</b></td>
        <td>${item.statusHtml}</td>
        <td>${escapeHtml(item.time)}</td>
      `;
      tbody.appendChild(tr);
    });

  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:red;">โหลดข้อมูลจาก AppSheet ไม่สำเร็จ กรุณารีเฟรช หรือตรวจสอบสิทธิ์การเข้าถึง</td></tr>';
  }
}

// รัน dashboard logic เฉพาะตอนอยู่หน้า dashboard.html เท่านั้น (เช็คจาก element ที่มีเฉพาะหน้านี้)
// ป้องกันไม่ให้หน้าอื่น (index/report/leave/checkout) ไปยิง fetch ข้อมูล dashboard โดยไม่จำเป็น
document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById('dashboard-date')) {
    displayCurrentDate();
    loadTodayDashboard();
  }
});
