const { MongoClient } = require('mongodb');
async function run() {
  const client = new MongoClient('mongodb+srv://aurawatterp_db_user:hilMyc6K6lTafiG6@cluster0.zmguksh.mongodb.net/aurawatt_ims?retryWrites=true&w=majority&appName=aurawatt_ims');
  await client.connect();
  const db = client.db('aurawatt_ims');
  
  const invRole = await db.collection('roles').findOne({ name: 'Inventory' });
  const invPerms = invRole.permissions.filter(p => p !== 'inventory:raw-materials');
  await db.collection('roles').updateOne({ name: 'Inventory' }, { $set: { permissions: invPerms, updatedAt: new Date() } });

  const whRole = await db.collection('roles').findOne({ name: 'Warehouse Team' });
  const whPerms = whRole.permissions.filter(p => p !== 'inventory:raw-materials');
  await db.collection('roles').updateOne({ name: 'Warehouse Team' }, { $set: { permissions: whPerms, updatedAt: new Date() } });

  console.log('Update result: OK');
  client.close();
}
run();
