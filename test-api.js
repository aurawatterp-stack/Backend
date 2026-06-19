const { MongoClient } = require('mongodb');

async function test() {
  const client = await MongoClient.connect('mongodb://localhost:27017');
  try {
    const db = client.db('aurawatt');
    
    // Simulate login
    const res = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'l1.nitin@avavbusiness.com', password: 'admin123' })
    });
    const user = await res.json();
    console.log("Login user:", user);
    
    // Simulate API fetch
    const res2 = await fetch('http://localhost:5000/api/complaints?page=1&limit=100&type=Consumer', {
      headers: { 'Authorization': 'Bearer ' + user.data.token }
    });
    
    if (res2.status === 500) {
      console.log("Error response text:", await res2.text());
    } else {
      console.log("Success status:", res2.status);
    }

  } catch (e) {
    console.error(e);
  } finally {
    client.close();
  }
}

test();
