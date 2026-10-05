export interface AuthenticatedUser {
  id: string;
  employee_code: string;
  full_name: string;
  email: string;
  role: 'ADMIN' | 'EMPLOYEE';
  user_type: 'EMPLOYEE' | 'INTERN';
  status: 'ACTIVE' | 'INACTIVE';
  title: string;
  phone: string | null;
  wfh_enabled: boolean;
  joined_on: string;
  probation_end_date: string | null;
  session_version: number;
}

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}
