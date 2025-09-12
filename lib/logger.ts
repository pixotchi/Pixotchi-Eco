type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: any;
}

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development';
  private isServer = typeof window === 'undefined';
  
  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    
    if (context && Object.keys(context).length > 0) {
      return `${prefix} ${message} ${JSON.stringify(context)}`;
    }
    
    return `${prefix} ${message}`;
  }
  
  private log(level: LogLevel, message: string, context?: LogContext) {
    const formattedMessage = this.formatMessage(level, message, context);
    
    // Always log to console (will appear in Vercel logs)
    const logMethod = level === 'error' ? console.error : 
                     level === 'warn' ? console.warn : 
                     console.log;
    
    logMethod(formattedMessage);
  }
  
  debug(message: string, context?: LogContext) {
    // Only log debug in development
    if (this.isDevelopment) {
      this.log('debug', message, context);
    }
  }
  
  info(message: string, context?: LogContext) {
    this.log('info', message, context);
  }
  
  warn(message: string, context?: LogContext) {
    this.log('warn', message, context);
  }
  
  error(message: string, error?: Error | unknown, context?: LogContext) {
    if (error instanceof Error) {
      this.log('error', message, { 
        ...context, 
        error: error.message, 
        stack: this.isDevelopment ? error.stack : undefined 
      });
    } else {
      this.log('error', message, { ...context, error });
    }
  }
}

export const logger = new Logger();