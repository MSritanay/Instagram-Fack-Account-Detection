import winston from 'winston';

const logFormat = winston.format.printf(({ level, message, timestamp, module, action, status, error }) => {
  let log = `${timestamp} [${module}] ${action} - ${status}: ${message}`;
  if (error) {
    log += ` | Error: ${error.stack || error.message || JSON.stringify(error)}`;
  }
  return log;
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      ),
    }),
    new winston.transports.File({ filename: 'server.log' }),
  ],
});

export const log = (
    module: 'UI' | 'Client ML' | 'Server ML' | 'DB' | 'API',
    action: string,
    status: 'STARTED' | 'SUCCESS' | 'FAILED',
    message: string,
    error?: any
) => {
    logger.info({ module, action, status, message, error });
};

export default logger;