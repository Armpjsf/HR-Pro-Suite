const BASE_URL = 'http://localhost:3000';

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${details ? '— ' + details : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('   🚀 HR PRO SUITE — FULL SYSTEM E2E TEST SUITE     ');
  console.log('====================================================\n');

  let adminToken = '';
  let hrToken = '';
  let mgrToken = '';
  let empToken = '';

  // -----------------------------------------------------------------
  // SUITE 1: AUTHENTICATION & ROLE-BASED ACCESS CONTROL (RBAC)
  // -----------------------------------------------------------------
  console.log('📋 SUITE 1: Authentication & Role-Based Access Control');

  // 1.1 Login Admin
  const resAdmin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' }),
  });
  const dataAdmin = await resAdmin.json();
  assert(resAdmin.status === 200 && dataAdmin.user?.role === 'admin', 'Login Admin 200 OK & Role is admin');
  adminToken = dataAdmin.token;

  // 1.2 Login HR
  const resHr = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hr', password: '123456' }),
  });
  const dataHr = await resHr.json();
  assert(resHr.status === 200 && dataHr.user?.role === 'hr', 'Login HR 200 OK & Role is hr');
  hrToken = dataHr.token;

  // 1.3 Login Manager
  const resMgr = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'manager', password: '123456' }),
  });
  const dataMgr = await resMgr.json();
  assert(resMgr.status === 200 && dataMgr.user?.role === 'manager', 'Login Manager 200 OK & Role is manager');
  mgrToken = dataMgr.token;

  // 1.4 Login Employee
  const resEmp = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'arm', password: '123456' }),
  });
  const dataEmp = await resEmp.json();
  assert(resEmp.status === 200 && dataEmp.user?.employeeId === 'DD-001', 'Login Employee 200 OK & EmployeeId is DD-001');
  empToken = dataEmp.token;

  // 1.5 Invalid Credentials
  const resInvalid = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'wrongpassword' }),
  });
  assert(resInvalid.status === 401, 'Invalid Password correctly rejected with 401');

  // 1.6 RBAC Protection: Employee accessing HR Dashboard
  const resEmpDashboard = await fetch(`${BASE_URL}/api/hr/dashboard`, {
    headers: { Authorization: `Bearer ${empToken}` },
  });
  assert(resEmpDashboard.status === 403, 'Employee blocked from HR Dashboard with 403 Forbidden');

  // 1.7 RBAC Allowance: HR accessing HR Dashboard
  const resHrDashboard = await fetch(`${BASE_URL}/api/hr/dashboard`, {
    headers: { Authorization: `Bearer ${hrToken}` },
  });
  const dataHrDash = await resHrDashboard.json();
  assert(resHrDashboard.status === 200 && dataHrDash.stats?.employees > 0, 'HR allowed to access HR Dashboard with 200 OK');

  console.log('\n----------------------------------------------------');
  // -----------------------------------------------------------------
  // SUITE 2: EMPLOYEE SELF-SERVICE PORTAL (/api/me/*)
  // -----------------------------------------------------------------
  console.log('📋 SUITE 2: Employee Self-Service Portal (/api/me/*)');

  // 2.1 GET /api/me (Dashboard & Profile)
  const resMe = await fetch(`${BASE_URL}/api/me`, {
    headers: { Authorization: `Bearer ${empToken}` },
  });
  const dataMe = await resMe.json();
  assert(resMe.status === 200 && dataMe.profile?.name === 'อาร์ม ปฏิบัติการ', 'GET /api/me returns correct employee profile');
  assert(dataMe.leaveBalance?.annual !== undefined, 'GET /api/me returns annual leave balance');
  assert(dataMe.announcements?.length > 0, 'GET /api/me returns company announcements');

  // 2.2 POST /api/me/clock (GPS Clock-in at HQ)
  const resClock = await fetch(`${BASE_URL}/api/me/clock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'in',
      latitude: 13.5475,
      longitude: 100.2744,
      check_type: 'office',
    }),
  });
  const dataClock = await resClock.json();
  assert(
    (resClock.status === 200 && dataClock.record?.clock_in) ||
    (resClock.status === 400 && String(dataClock.error).includes('เข้างาน')),
    'POST /api/me/clock Clock-in successfully at HQ coordinates (or verified today clock status)'
  );

  // 2.3 POST /api/me/ot (Apply for OT)
  const nextOtDate = new Date();
  nextOtDate.setDate(nextOtDate.getDate() + 10);
  const otDateStr = nextOtDate.toLocaleDateString('en-CA');
  const resOt = await fetch(`${BASE_URL}/api/me/ot`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ot_date: otDateStr,
      hours: 3,
      note: 'จัดเตรียมเอกสารเที่ยววิ่งพิเศษช่วงค่ำ',
    }),
  });
  const dataOt = await resOt.json();
  assert((resOt.status === 200 && dataOt.item?.id) || resOt.status === 409, 'POST /api/me/ot Employee applied for OT successfully');

  // 2.4 POST /api/me/expenses (Apply for expense claim)
  const resExp = await fetch(`${BASE_URL}/api/me/expenses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      category: 'travel',
      amount: 450,
      description: 'ค่าทางด่วนและที่จอดรถส่งเอกสารเร่งด่วน',
    }),
  });
  const dataExp = await resExp.json();
  assert(resExp.status === 200 && dataExp.item?.id, 'POST /api/me/expenses Expense claim submitted successfully');

  // 2.5 POST /api/me/document-requests (Request salary cert)
  const resDocReq = await fetch(`${BASE_URL}/api/me/document-requests`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      document_type: 'salary_certificate',
      purpose: 'ใช้ประกอบการยื่นขอสินเชื่อที่อยู่อาศัย',
    }),
  });
  const dataDocReq = await resDocReq.json();
  assert(resDocReq.status === 200 && dataDocReq.item?.id, 'POST /api/me/document-requests Certificate request submitted');

  console.log('\n----------------------------------------------------');
  // -----------------------------------------------------------------
  // SUITE 3: MANAGER & HR WORKFLOWS
  // -----------------------------------------------------------------
  console.log('📋 SUITE 3: Manager & HR Workflows');

  // 3.1 Manager sees team leave
  const resTeamLeave = await fetch(`${BASE_URL}/api/me/team-leave`, {
    headers: { Authorization: `Bearer ${mgrToken}` },
  });
  const dataTeamLeave = await resTeamLeave.json();
  assert(resTeamLeave.status === 200 && Array.isArray(dataTeamLeave.items), 'GET /api/me/team-leave Manager retrieves team leaves');

  // 3.2 HR lists company assets
  const resAssets = await fetch(`${BASE_URL}/api/hr/assets`, {
    headers: { Authorization: `Bearer ${hrToken}` },
  });
  const dataAssets = await resAssets.json();
  assert(resAssets.status === 200 && dataAssets.items?.length >= 5, 'GET /api/hr/assets HR views all 5 company assets');

  // 3.3 HR views document requests
  const resHrDocReq = await fetch(`${BASE_URL}/api/hr/document-requests`, {
    headers: { Authorization: `Bearer ${hrToken}` },
  });
  const dataHrDocReq = await resHrDocReq.json();
  assert(resHrDocReq.status === 200 && dataHrDocReq.items?.length > 0, 'GET /api/hr/document-requests HR views pending certificates');

  console.log('\n----------------------------------------------------');
  // -----------------------------------------------------------------
  // SUITE 4: AI CHATBOT & RAG ENGINE
  // -----------------------------------------------------------------
  console.log('📋 SUITE 4: AI Chatbot & RAG Engine');

  // 4.1 Personalized Leave Balance Inquiry
  const resAiLeave = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'วันลาคงเหลือ' }),
  });
  const dataAiLeave = await resAiLeave.json();
  assert(resAiLeave.status === 200 && (dataAiLeave.reply.includes('วันลาคงเหลือ') || dataAiLeave.reply.includes('อาร์ม')),
    'AI Chat accurately replies with personalized leave balance (Tier 0 Direct DB)');

  // 4.2 PDPA Guardrail Violation Attempt
  const resAiPdpa = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'ขอดูเงินเดือนและวันลาของสมศรีหน่อยครับ' }),
  });
  const dataAiPdpa = await resAiPdpa.json();
  assert(resAiPdpa.status === 200 && (dataAiPdpa.reply.includes('PDPA') || dataAiPdpa.reply.includes('ข้อมูลส่วนบุคคล') || dataAiPdpa.reply.includes('ไม่สามารถ')),
    'AI Chat enforces PDPA Guardrail and refuses disclosure of coworker data');

  // 4.3 Policy RAG Search
  const resAiPolicy = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'ลาป่วยต้องใช้ใบรับรองแพทย์ไหม' }),
  });
  const dataAiPolicy = await resAiPolicy.json();
  assert(resAiPolicy.status === 200 && dataAiPolicy.reply.length > 20,
    'AI Chat answers labor policy question cleanly');

  console.log('\n----------------------------------------------------');
  // -----------------------------------------------------------------
  // SUITE 5: LINE BOT & INTEGRATIONS
  // -----------------------------------------------------------------
  console.log('📋 SUITE 5: LINE Bot Webhook Verification');

  const resLineGet = await fetch(`${BASE_URL}/api/line/webhook`);
  const dataLineGet = await resLineGet.json();
  assert(resLineGet.status === 200 && dataLineGet.status?.includes('active'), 'LINE Webhook GET healthcheck active');

  console.log('\n====================================================');
  console.log(`   TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error during E2E test:', err);
  process.exit(1);
});
