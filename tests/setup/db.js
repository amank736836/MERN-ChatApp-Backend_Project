import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongod;

async function startDb() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
}

async function closeDb() {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
  }
}

export { startDb, closeDb };
