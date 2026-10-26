export type EmployeeRole = 'SUPER_ADMIN' | 'ADMIN' | 'EMPLOYEE' | 'INTERN';
export type EmployeeUserType = 'SUPER_ADMIN' | 'ADMIN' | 'EMPLOYEE' | 'INTERN';

export interface AuthenticatedUser {
  id: string;
  employee_code: string;
  full_name: string;
  email: string;
  role: EmployeeRole;
  user_type: EmployeeUserType;
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
