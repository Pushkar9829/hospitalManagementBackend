import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { logger } from '../observability/logger.js';

mongoose.set('strictQuery', true);
// Operations inside connection.transaction() pick up the session automatically.
mongoose.set('transactionAsyncLocalStorage', true);

export async function connectDb(uri = env.MONGO_URI) {
  await mongoose.connect(uri, {
    autoIndex: !env.isProd, // production indexes are built by migrations
    maxPoolSize: 50,
    serverSelectionTimeoutMS: 10_000,
  });
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
