import { z } from 'zod';
import { ZodError } from 'zod';

export const idSchema = z.string().uuid();
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date=new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
},'Choose a valid calendar date.');
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export function validate(schema, input) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const error = new Error(parsed.error.issues.map((x) => x.message).join(' '));
    error.status = 400;
    throw error;
  }
  return parsed.data;
}
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof ZodError) return res.status(400).json({ error: 'Please check the information and try again.' });
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That record already exists.' });
  const status = error.status || 500;
  if (status >= 500) console.error(JSON.stringify({type:'http_error',request_id:req.requestId,error:String(error?.message||error),method:req.method,path:req.path,status}));
  res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : error.message, requestId: req.requestId });
}
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
