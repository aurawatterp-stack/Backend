const { MongoClient } = require('mongodb');
async function run() {
  const client = new MongoClient('mongodb+srv://aurawatterp_db_user:hilMyc6K6lTafiG6@cluster0.zmguksh.mongodb.net/aurawatt_ims?retryWrites=true&w=majority&appName=aurawatt_ims');
  await client.connect();
  const db = client.db('aurawatt_ims');
  const role = await db.collection('roles').findOne({ name: 'Inventory' });
  const permissions = role.permissions.filter(p => p !== 'inventory:raw-materials');
  const result = await db.collection('roles').updateOne({ name: 'Inventory' }, { $set: { permissions, updatedAt: new Date() } });
  console.log('Update result:', result);
  client.close();
}
run();
