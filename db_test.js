const { MongoClient } = require('mongodb');
async function run() {
  const client = new MongoClient('mongodb+srv://aurawatterp_db_user:hilMyc6K6lTafiG6@cluster0.zmguksh.mongodb.net/aurawatt_ims?retryWrites=true&w=majority&appName=aurawatt_ims');
  await client.connect();
  const db = client.db('aurawatt_ims');
  const roles = await db.collection('roles').find({ name: { $in: ['Inventory', 'Warehouse Team'] } }).toArray();
  console.log(JSON.stringify(roles, null, 2));
  client.close();
}
run();
