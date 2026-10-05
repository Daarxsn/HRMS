import mysql from 'mysql2/promise';

const production = process.env.NODE_ENV === 'production';
const connectionLimit = Number(process.env.DB_CONNECTION_LIMIT || 10);
const maxIdle = Number(process.env.DB_MAX_IDLE || connectionLimit);

if(!Number.isInteger(connectionLimit)||connectionLimit<1||connectionLimit>50)throw new Error('DB_CONNECTION_LIMIT must be an integer between 1 and 50.');
if(!Number.isInteger(maxIdle)||maxIdle<1||maxIdle>connectionLimit)throw new Error('DB_MAX_IDLE must be an integer between 1 and DB_CONNECTION_LIMIT.');

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'falchion_xeniaa',
  waitForConnections: true,
  connectionLimit,
  maxIdle,
  idleTimeout: 60000,
  queueLimit: 20,
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  timezone: 'Z',
  dateStrings: true,
  namedPlaceholders: true,
  ...(process.env.DB_SOCKET_PATH ? { socketPath: process.env.DB_SOCKET_PATH } : {})
};

if(production&&(!process.env.DB_NAME||!process.env.DB_USER||!process.env.DB_PASSWORD))throw new Error('DB_NAME, DB_USER and DB_PASSWORD are required in production.');

export const pool = mysql.createPool(config);
export const query = async (sql: string, values: any = {}): Promise<any> => {
  const [rows] = await pool.execute(sql, values);
  return rows;
};
const transactionRetries = Number(process.env.DB_TRANSACTION_RETRIES || 2);
if(!Number.isInteger(transactionRetries)||transactionRetries<0||transactionRetries>5)throw new Error('DB_TRANSACTION_RETRIES must be an integer between 0 and 5.');

const transientTransactionErrors = new Set(['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const transaction = async (fn: (connection: any) => Promise<any>): Promise<any> => {
  for (let attempt = 0; attempt <= transactionRetries; attempt += 1) {
    const connection = await pool.getConnection();
    let inTransaction = false;
    try {
      await connection.beginTransaction();
      inTransaction = true;
      const result = await fn(connection);
      await connection.commit();
      inTransaction = false;
      return result;
    } catch (error) {
      if (inTransaction) {
        try { await connection.rollback(); } catch (rollbackError) {
          console.error(JSON.stringify({type:'transaction_rollback_error',error:String(rollbackError?.message||rollbackError)}));
        }
      }
      const retryable = transientTransactionErrors.has(error?.code) && attempt < transactionRetries;
      if (!retryable) throw error;
      const delay = 50 * 2 ** attempt;
      console.warn(JSON.stringify({type:'transaction_retry',attempt:attempt+1,code:error.code,delay_ms:delay}));
      await sleep(delay);
    } finally {
      connection.release();
    }
  }
  throw new Error('Transaction could not be completed.');
};
