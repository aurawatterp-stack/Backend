const xlsx = require('xlsx');
const path = 'D:/bma/Aurawat/Aurawatt_15Mar2026_to_Last_Verified.xlsx';
const workbook = xlsx.readFile(path);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
console.log("HEADERS:", data[0]);
console.log("FIRST DATA ROW:", data[1]);
