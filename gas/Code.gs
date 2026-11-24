// ============================================================
// ระบบบันทึกคุณภาพน้ำ (Quality Water Check) - Backend (Google Apps Script)
// รองรับทั้งการทำงานตรงใน Google Apps Script และเป็น Web API สำหรับ GitHub Pages
// ============================================================

// หากใช้เป็น Standalone Script ให้ใส่ Spreadsheet ID ที่นี่ (ถ้าสร้างจากเมนู ส่วนขยาย > Apps Script ไม่ต้องใส่)
var SPREADSHEET_ID = "";

function getSpreadsheet() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss;
  } catch (e) {}
  if (SPREADSHEET_ID && SPREADSHEET_ID.trim() !== "") {
    return SpreadsheetApp.openById(SPREADSHEET_ID.trim());
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

// ------------------------------------------------------------
// 1. Web API Endpoints สำหรับ GitHub Pages (CORS Friendly)
// ------------------------------------------------------------
function doGet(e) {
  // หากมีพารามิเตอร์เรียกจาก GitHub Pages (Web API)
  if (e && e.parameter && e.parameter.action) {
    return handleApiRequest(e.parameter);
  }

  // หากเปิดตรงผ่าน URL ของ Google Apps Script (รองรับโค้ดเดิม)
  try {
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Quality Water Check')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "online",
      message: "Quality Water Check Web API is running.",
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  var params = {};
  if (e && e.postData && e.postData.contents) {
    try {
      params = JSON.parse(e.postData.contents);
    } catch (err) {
      params = e.parameter || {};
    }
  } else if (e && e.parameter) {
    params = e.parameter;
  }
  return handleApiRequest(params);
}

function handleApiRequest(params) {
  var action = params.action;
  var output;

  try {
    if (action === "getHistory") {
      var history = getHistory();
      output = { status: "success", data: history };
    } else if (action === "saveData") {
      var date = params.date;
      var ph = params.ph;
      var tds = params.tds;
      var resultStr = saveData(date, ph, tds);
      output = { status: "success", data: JSON.parse(resultStr) };
    } else {
      output = { status: "error", message: "Unknown action: " + action };
    }
  } catch (error) {
    output = { status: "error", message: error.toString() };
  }

  return ContentService.createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------
// 2. ฟังก์ชันตรวจสอบและแปลงวันที่ (รองรับทั้ง YYYY-MM-DD และ DD/MM/YYYY พ.ศ.)
// ------------------------------------------------------------
function parseDateValue(val) {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  var str = String(val).trim();
  
  if (str.indexOf('/') > -1) {
    // รูปแบบ dd/mm/yyyy
    var parts = str.split('/');
    var d = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;
    var y = parseInt(parts[2], 10);
    if (y > 2400) y -= 543; // ปรับปี พ.ศ. กลับเป็น ค.ศ. สำหรับ Date Object
    return new Date(y, m, d);
  } else if (str.indexOf('-') > -1) {
    // รูปแบบ yyyy-mm-dd
    var parts = str.split('-');
    var y = parseInt(parts[0], 10);
    if (y > 2400) y -= 543;
    var m = parseInt(parts[1], 10) - 1;
    var d = parseInt(parts[2], 10);
    return new Date(y, m, d);
  }
  var parsed = new Date(val);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

// แปลงเป็น dd/mm/yyyy (พ.ศ.)
function formatDateToThaiBE(dateVal) {
  var dObj = parseDateValue(dateVal);
  var day = ('0' + dObj.getDate()).slice(-2);
  var month = ('0' + (dObj.getMonth() + 1)).slice(-2);
  var yearBE = dObj.getFullYear() + 543;
  return day + '/' + month + '/' + yearBE;
}

// ------------------------------------------------------------
// 3. ฟังก์ชันสำหรับบันทึกข้อมูล พร้อมการแปลผล (คงตรรกะเดิม 100%)
// ------------------------------------------------------------
function saveData(date, ph, tds) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    var ss = getSpreadsheet();
    var sheet = ss.getActiveSheet();
    var phNum = parseFloat(ph);
    var tdsNum = parseFloat(tds);
    
    // แปลผล pH
    var phResult = "";
    if (phNum < 6.5) phResult = "ควรปรับปรุง";
    else if (phNum < 6.9) phResult = "พอใช้";
    else if (phNum < 7.6) phResult = "ดี";
    else if (phNum <= 8.5) phResult = "พอใช้";
    else phResult = "ควรปรับปรุง";
    
    // แปลผล TDS
    var tdsResult = "";
    if (tdsNum < 500) tdsResult = "ดี";
    else if (tdsNum <= 1000) tdsResult = "พอใช้";
    else tdsResult = "ควรปรับปรุง";
    
    // แปลผลรวม (ภาพรวม)
    var overallResult = "";
    if (phResult === "ควรปรับปรุง" || tdsResult === "ควรปรับปรุง") {
      overallResult = "ควรปรับปรุง";
    } else if (phResult === "พอใช้" || tdsResult === "พอใช้") {
      overallResult = "พอใช้";
    } else {
      overallResult = "ดี";
    }
    
    // ตรวจสอบและสร้างหัวข้อคอลัมน์หากยังไม่มี
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Timestamp", "วันที่บันทึก", "ค่า pH", "แปลผล pH", "ค่า TDS", "แปลผล TDS", "ภาพรวม"]);
      sheet.getRange("A1:G1").setFontWeight("bold").setBackground("#d0e0e3");
    }
    
    // รองรับการบันทึกทั้ง dd/mm/yyyy พ.ศ.
    var formattedDateForSave = date;
    if (date) {
      formattedDateForSave = formatDateToThaiBE(date);
    } else {
      formattedDateForSave = formatDateToThaiBE(new Date());
    }

    sheet.appendRow([new Date(), formattedDateForSave, phNum, phResult, tdsNum, tdsResult, overallResult]);
    
    // ส่งข้อมูลกลับไปให้ Popup แสดงผล
    return JSON.stringify({
      ph: phNum,
      phStatus: phResult,
      tds: tdsNum,
      tdsStatus: tdsResult,
      overall: overallResult
    });
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------
// 4. ฟังก์ชันดึงข้อมูลประวัติ (เรียงตามวันที่ พร้อมส่งออกรูปแบบ พ.ศ.)
// ------------------------------------------------------------
function getHistory() {
  var ss = getSpreadsheet();
  var sheet = ss.getActiveSheet();
  if (sheet.getLastRow() <= 1) return []; // ไม่มีข้อมูล
  
  // ดึงข้อมูล 6 คอลัมน์ (วันที่, pH, แปลผล pH, TDS, แปลผล TDS, ภาพรวม)
  var data = sheet.getRange(2, 2, sheet.getLastRow() - 1, 6).getValues(); 
  
  var formattedData = data.map(function(row) {
    var dateFormatted = formatDateToThaiBE(row[0]);
    return [dateFormatted, row[1], row[2], row[3], row[4], row[5] || ""];
  });
  
  formattedData.sort(function(a, b) {
    return parseDateValue(a[0]).getTime() - parseDateValue(b[0]).getTime();
  });
  
  return formattedData;
}
