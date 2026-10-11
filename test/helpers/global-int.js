import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Integration tests need a replica set (transactions). Uses MONGO_URI when given (CI service or
 * docker-compose), otherwise starts an in-memory replica set (downloads mongod once).
 */
export default async function setup(project) {
  let replSet;
  let uri = process.env.MONGO_TEST_URI;
  process.env.MONGOMS_VERSION ??= '8.0.4';
  if (!uri) {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    uri = replSet.getUri();
  }
  project.provide('mongoUri', uri);
  return async () => {
    await replSet?.stop();
  };
}
