export function validateClockInput({ action, check_type = 'office', latitude, longitude }) {
  if (!['in', 'out'].includes(action)) return 'กรุณาระบุการเข้างานหรือออกงาน';
  // WFH needs an approved assignment workflow before enabling it.
  if (!['office', 'offsite'].includes(check_type)) return 'ประเภทการลงเวลาไม่ถูกต้องหรือยังไม่ได้รับอนุญาต';
  if (typeof latitude !== 'number' || typeof longitude !== 'number'
    || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return 'กรุณาเปิด GPS และรอให้ได้พิกัดที่ถูกต้องก่อนลงเวลา';
  }
  return null;
}
