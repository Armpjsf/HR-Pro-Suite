/**
 * เครื่องคำนวณเงินเดือนไทย — ประกันสังคม + ภาษีเงินได้บุคคลธรรมดา (หัก ณ ที่จ่าย)
 * เป็นการประมาณการตามหลักเกณฑ์มาตรฐาน ใช้เป็นค่าตั้งต้น HR ปรับได้
 */

// ประกันสังคม 5% ของฐานเงินเดือน เพดานฐาน 15,000 (สูงสุด 750 บาท/เดือน)
export function calcSso(monthlySalary) {
  const base = Math.min(Math.max(Number(monthlySalary) || 0, 0), 15000);
  return Math.round(base * 0.05);
}

// ขั้นบันไดภาษีเงินได้บุคคลธรรมดา (ต่อปี)
const TAX_BRACKETS = [
  { upTo: 150000, rate: 0 },
  { upTo: 300000, rate: 0.05 },
  { upTo: 500000, rate: 0.10 },
  { upTo: 750000, rate: 0.15 },
  { upTo: 1000000, rate: 0.20 },
  { upTo: 2000000, rate: 0.25 },
  { upTo: 5000000, rate: 0.30 },
  { upTo: Infinity, rate: 0.35 },
];

export function progressiveTax(netIncome) {
  let tax = 0;
  let lower = 0;
  for (const b of TAX_BRACKETS) {
    if (netIncome > b.upTo) {
      tax += (b.upTo - lower) * b.rate;
      lower = b.upTo;
    } else {
      tax += (netIncome - lower) * b.rate;
      break;
    }
  }
  return Math.max(0, tax);
}

// รายการลดหย่อนแบบมีป้ายกำกับ (ใช้แสดงในสลิป/50ทวิ)
export function deductionBreakdown(annualIncome, ssoAnnual, a = {}) {
  const items = [
    { label: 'ค่าใช้จ่าย', amount: Math.min(annualIncome * 0.5, 100000) },
    { label: 'ค่าลดหย่อนส่วนตัวของผู้มีเงินได้', amount: 60000 },
  ];
  if (a.spouse) items.push({ label: 'ค่าลดหย่อนคู่สมรส', amount: 60000 });
  const children = Number(a.children) || 0;
  if (children) items.push({ label: `ค่าลดหย่อนบุตร (${children} คน)`, amount: children * 30000 });
  const parents = Number(a.parents) || 0;
  if (parents) items.push({ label: `ค่าเลี้ยงดูบิดามารดา (${parents} คน)`, amount: parents * 30000 });
  const life = Math.min(Number(a.life_insurance) || 0, 100000);
  if (life) items.push({ label: 'เบี้ยประกันชีวิต', amount: life });
  const health = Math.min(Number(a.health_insurance) || 0, 25000);
  if (health) items.push({ label: 'เบี้ยประกันสุขภาพ', amount: health });
  const pvd = Math.min(Number(a.provident_fund) || 0, 500000);
  if (pvd) items.push({ label: 'กองทุนสำรองเลี้ยงชีพ', amount: pvd });
  const mortgage = Math.min(Number(a.mortgage) || 0, 100000);
  if (mortgage) items.push({ label: 'ดอกเบี้ยกู้ซื้อบ้าน', amount: mortgage });
  const sso = Math.min(ssoAnnual, 9000);
  if (sso) items.push({ label: 'เงินสะสมกองทุนประกันสังคม', amount: sso });
  const donation = Math.min(Number(a.donation) || 0, annualIncome * 0.1);
  if (donation) items.push({ label: 'เงินบริจาค', amount: donation });
  return items;
}

// รวมค่าลดหย่อนรายปี จากแบบ ลย.01 + ค่าใช้จ่าย/ส่วนตัว/ปกส.
export function annualDeductions(annualIncome, ssoAnnual, a = {}) {
  const expense = Math.min(annualIncome * 0.5, 100000); // ค่าใช้จ่าย 50% สูงสุด 100,000
  const personal = 60000;                                // ลดหย่อนส่วนตัว
  const spouse = a.spouse ? 60000 : 0;
  const children = (Number(a.children) || 0) * 30000;
  const parents = (Number(a.parents) || 0) * 30000;
  const life = Math.min(Number(a.life_insurance) || 0, 100000);
  const health = Math.min(Number(a.health_insurance) || 0, 25000);
  const pvd = Math.min(Number(a.provident_fund) || 0, 500000);
  const mortgage = Math.min(Number(a.mortgage) || 0, 100000);
  const sso = Math.min(ssoAnnual, 9000);
  const donation = Math.min(Number(a.donation) || 0, annualIncome * 0.1);
  return expense + personal + spouse + children + parents + life + health + pvd + mortgage + sso + donation;
}

/**
 * คำนวณภาษีหัก ณ ที่จ่ายรายเดือน (ประมาณการ)
 * @param {object} p { monthlySalary, otMonthly, bonusMonthly, ssoMonthly, allowances }
 */
export function calcMonthlyTax({ monthlySalary = 0, otMonthly = 0, bonusMonthly = 0, ssoMonthly = 0, allowances = {} }) {
  const annualIncome = Number(monthlySalary) * 12 + Number(otMonthly) * 12 + Number(bonusMonthly);
  const ssoAnnual = Number(ssoMonthly) * 12;
  const deductions = annualDeductions(annualIncome, ssoAnnual, allowances);
  const netIncome = Math.max(0, annualIncome - deductions);
  const annualTax = progressiveTax(netIncome);
  return Math.round(annualTax / 12);
}

/**
 * คำนวณสลิปทั้งใบจากเงินเดือนฐาน + OT + โบนัส + ลดหย่อน
 */
export function computeSlip({ monthlySalary = 0, otMonthly = 0, bonusMonthly = 0, otherDeduction = 0, allowances = {} }) {
  const sso = calcSso(monthlySalary);
  const tax = calcMonthlyTax({ monthlySalary, otMonthly, bonusMonthly, ssoMonthly: sso, allowances });
  const base = Number(monthlySalary) || 0;
  const ot = Number(otMonthly) || 0;
  const bonus = Number(bonusMonthly) || 0;
  const other = Number(otherDeduction) || 0;
  const net = base + ot + bonus - tax - sso - other;
  return { base_salary: base, ot_pay: ot, bonus, tax, sso, deduction: other, net };
}
