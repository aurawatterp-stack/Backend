async function run() {
  try {
    const r1 = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'l1.nitin@avavbusiness.com', password: 'NitinL1@123' })
    });
    const user = await r1.json();
    console.log("Token:", user.data?.token?.substring(0, 10));

    const r2 = await fetch('http://localhost:5000/api/complaints?page=1&limit=100&type=Consumer', {
      headers: { 'Authorization': 'Bearer ' + user.data.token }
    });
    console.log("Status:", r2.status);
    const text = await r2.text();
    console.log("Response:", text);
  } catch (err) {
    console.error("Error:", err);
  }
}
run();
