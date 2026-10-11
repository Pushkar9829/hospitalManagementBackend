# Role panels

Each role logs in to its own panel: its own home page, menu and data scope. The menu below is exactly what that role sees. Anything not listed is hidden from the menu and refused by the API.

## Super Admin

- Roles: Hospital Super Admin
- Home: boards/Dashboard.dc.html
- Data scope: Whole hospital, all branches
- Menu:
  - **Overview:** Dashboard, OPD Analytics, IPD Analytics, Billing Analytics, Lab Analytics, Approvals, Reports, Audit Log
  - **Patients:** Patients, Patient Profile, Front Office, OPD Check-in, Appointments, Admissions, Bed Board, Bed Requests, Discharge Desk
  - **Clinical:** Consultation, OPD Triage, In-patient Rounds, Nursing Station, Rosters
  - **Diagnostics:** Laboratory, Sample Collection, Lab Settings, Radiology, Pharmacy
  - **Business:** Billing, Shifts and Day-end, In-patient Bills, Insurance Desk, Corporate and Credit, Finance, Inventory, HR, Payroll
  - **Support:** Medical Records, Diet & Kitchen, Facility, Quality, CRM
  - **Settings:** Hospital Settings, Users, Roles & Access, Departments, OPD Settings, IPD Settings, Billing Settings, Subscription
  - **Personal:** My Space

## Hospital Admin

- Roles: Hospital Admin
- Home: boards/HomeAdmin.dc.html
- Data scope: Branch
- Menu:
  - **Overview:** Home, Approvals, Reports, Finance
  - **Operations:** Patients, Front Office, Bed Board, Inventory, Appointments, Admissions, Nursing Station, HR
  - **Settings:** Hospital Settings, Users, Roles & Access, Departments, OPD Settings, IPD Settings, Billing Settings
  - **Services:** Medical Records, Diet & Kitchen, Facility, Quality, CRM
  - **Departments setup:** Laboratory, Radiology, Pharmacy
  - **Personal:** My Space

## Medical Superintendent

- Roles: Medical Superintendent
- Home: boards/HomeMedSupt.dc.html
- Data scope: Branch, clinical
- Menu:
  - **Overview:** Home, OPD Analytics, IPD Analytics, Lab Analytics, Approvals, Reports
  - **Clinical:** Bed Board, Bed Requests, Discharge Desk, Nursing Station, Rosters
  - **Governance:** Medical Records, Quality
  - **Services (read):** Diet & Kitchen, Facility, CRM
  - **Personal:** My Space

## Doctor

- Roles: Consultant, Resident
- Home: boards/HomeDoctor.dc.html
- Data scope: Own patients and department
- Menu:
  - **My day:** Home, OPD Consultation, In-patient Rounds, Discharge Desk
  - **Patients:** Patient Profile, Bed Board
  - **Results:** Laboratory, Radiology, Microbiology, Histopathology
  - **Records and orders:** Medical Records, Diet Orders, CRM
  - **Personal:** My Space

## Head of Department

- Roles: Department Head (HOD)
- Home: boards/HomeHod.dc.html
- Data scope: Own department (Cardiology)
- Menu:
  - **My department:** Home, Approvals, Rosters, Reports
  - **Clinical:** OPD Consultation, In-patient Rounds, Discharge Desk, Bed Board
  - **Department:** Indents and Stock, Quality
  - **Personal:** My Space

## Clinic (one-screen mode)

- Roles: Clinic doctor who is also the admin
- Home: boards/ClinicDesk.dc.html
- Data scope: Whole clinic
- Menu:
  - **Clinic:** Today's Clinic, Appointments, Patients, Billing, Pharmacy
  - **Setup:** Clinic Settings, Users, Reports, Subscription
  - **Personal:** My Space

## Staff Nurse

- Roles: Staff Nurse
- Home: boards/HomeNurse.dc.html
- Data scope: Assigned ward
- Menu:
  - **My ward:** Home, Nursing Station, Bed Board, Patient Profile
  - **OPD:** OPD Triage
  - **Requests:** Diet Orders, Tickets and Transport, Report Incident
  - **Results:** Laboratory, Radiology, Medical Records, Sample Collection
  - **Personal:** My Space

## Ward In-charge

- Roles: Ward In-charge (Sister), Nursing Superintendent
- Home: boards/HomeWardIncharge.dc.html
- Data scope: Ward (Nursing Superintendent: all wards in the branch)
- Menu:
  - **My ward:** Home, Nursing Station, Rosters, Bed Board, Bed Requests
  - **Requests:** Approvals, Store Indents, Facility, Quality
  - **Personal:** My Space

## Front Office

- Roles: Front Office, Admission Desk
- Home: boards/HomeFrontOffice.dc.html
- Data scope: Branch
- Menu:
  - **Front desk:** Home, Front Office, OPD Check-in, Register Patient, Patient Profile, Appointments
  - **In-patients:** Admissions, Bed Board, Bed Requests
  - **Records and CRM:** Medical Records, CRM
  - **Personal:** My Space

## Security Desk

- Roles: Security Desk
- Home: boards/HomeSecurity.dc.html
- Data scope: Gate and ward entrances
- Menu:
  - **Gate:** Home, Visitors and Passes, Bed Board
  - **Requests:** Tickets, Report Incident
  - **Personal:** My Space

## Cashier

- Roles: Cashier
- Home: boards/HomeCashier.dc.html
- Data scope: Own counter
- Menu:
  - **Counter:** Home, Billing Counter, Cashier Shift, In-patient Bills, Find Patient
  - **Reports:** Collection Reports
  - **Lookups (read):** Laboratory, Radiology, Pharmacy
  - **Personal:** My Space

## Billing Manager

- Roles: Billing Manager
- Home: boards/HomeBillingMgr.dc.html
- Data scope: Branch billing
- Menu:
  - **Billing:** Home, Billing, Shifts and Day-end, In-patient Bills, Insurance Desk, Corporate and Credit, Discharge Desk, Approvals
  - **Reports:** Reports, Billing Analytics
  - **Finance (read):** Finance
  - **Lookups (read):** Laboratory, Radiology, Pharmacy
  - **Personal:** My Space

## Insurance Desk

- Roles: Insurance Desk (TPA Coordinator)
- Home: boards/HomeTpa.dc.html
- Data scope: Branch, insured and scheme patients
- Menu:
  - **Insurance:** Home, Insurance Desk, In-patient Bills, Discharge Desk
  - **Patients (read):** Admissions, Patient Profile
  - **Reports:** Reports
  - **Personal:** My Space

## Laboratory

- Roles: Lab Technician, Pathologist
- Home: boards/HomeLab.dc.html
- Data scope: Laboratory
- Menu:
  - **Laboratory:** Home, Worklists, Sample Collection, Quality Control, Microbiology, Histopathology, Lab Settings, Lab Analytics, Patient Profile
  - **Requests:** Store Indents, Quality
  - **Personal:** My Space

## Home Collection

- Roles: Home Collection Phlebotomist
- Home: boards/HomePhlebo.dc.html
- Data scope: Assigned area, own visits
- Menu:
  - **Visits:** Home, Laboratory, Sample Collection
  - **Personal:** My Space

## Radiology

- Roles: Radiology Technician, Radiologist
- Home: boards/HomeRadiology.dc.html
- Data scope: Radiology
- Menu:
  - **Radiology:** Home, Worklist and Reporting, Patient Profile
  - **Requests:** Equipment Tickets
  - **Personal:** My Space

## Pharmacy

- Roles: Pharmacist, Pharmacy In-charge
- Home: boards/HomePharmacy.dc.html
- Data scope: Pharmacy stores
- Menu:
  - **Pharmacy:** Home, Dispensing, Stock, Counter Shift
  - **Reports:** Reports
  - **Patients (read):** Appointments, Bed Board
  - **Personal:** My Space

## Store and Purchase

- Roles: Store Keeper, Purchase Manager
- Home: boards/HomeStore.dc.html
- Data scope: Stores
- Menu:
  - **Stores:** Home, Inventory, Approvals
  - **Reports:** Reports
  - **Finance (read):** Finance
  - **Pharmacy stock:** Pharmacy
  - **Personal:** My Space

## HR

- Roles: HR Manager, HR Executive
- Home: boards/HomeHr.dc.html
- Data scope: All employees
- Menu:
  - **People:** Home, HR and Attendance, Rosters, Payroll
  - **Work:** Approvals, Reports
  - **Personal:** My Space

## Payroll

- Roles: Payroll Officer
- Home: boards/HomePayroll.dc.html
- Data scope: Payroll entity
- Menu:
  - **Payroll:** Home, Payroll Run, Attendance
  - **Reports:** Reports
  - **Finance (read):** Finance
  - **Personal:** My Space

## Accounts

- Roles: Accountant, Finance Controller
- Home: boards/HomeAccounts.dc.html
- Data scope: Legal entity
- Menu:
  - **Finance:** Home, Finance, Approvals, Shifts and Day-end
  - **Source modules:** Billing, Payroll, Inventory, In-patient Bills, Pharmacy
  - **Reports:** Reports, Billing Analytics
  - **Personal:** My Space

## Auditor

- Roles: Auditor (internal or statutory), read-only
- Home: boards/HomeAuditor.dc.html
- Data scope: Whole hospital, read-only
- Menu:
  - **Overview:** Home, Audit Log, Reports
  - **Books and records:** Finance, Inventory, Payroll, Approvals History, Shifts and Day-end

## Medical Records

- Roles: MRD Officer, Medical Coder
- Home: boards/HomeMrd.dc.html
- Data scope: All records, no billing
- Menu:
  - **Records:** Home, Medical Records, Patient Profile, Approvals
  - **Reports:** Reports
  - **Personal:** My Space

## Kitchen

- Roles: Dietitian, Kitchen Supervisor
- Home: boards/HomeKitchen.dc.html
- Data scope: Kitchen
- Menu:
  - **Kitchen:** Home, Diet and Kitchen, Kitchen Store
  - **Personal:** My Space

## Facility

- Roles: Housekeeping Supervisor, Maintenance, Biomedical Engineer
- Home: boards/HomeFacility.dc.html
- Data scope: Branch facilities
- Menu:
  - **Facility:** Home, Housekeeping and Facility, Bed Board, Store Indents, Approvals
  - **Personal:** My Space

## Quality

- Roles: Quality Manager, Infection Control Nurse
- Home: boards/HomeQuality.dc.html
- Data scope: Whole hospital, read-only clinical
- Menu:
  - **Quality:** Home, Quality and Incidents, Medical Records, Approvals
  - **Reports:** Reports
  - **Services (read):** Diet & Kitchen, Facility, CRM, Microbiology (antibiogram)
  - **Personal:** My Space

## CRM and Call Centre

- Roles: CRM Executive, Call Centre
- Home: boards/HomeCrm.dc.html
- Data scope: Patients, no clinical notes
- Menu:
  - **Engagement:** Home, CRM, Appointments, Patients
  - **Reports:** Reports
  - **Personal:** My Space

## Employee

- Roles: Every staff login
- Home: boards/MySpace.dc.html
- Data scope: Own records
- Menu:
  - **Personal:** My Space

## Platform owner

- Home: boards/Console.dc.html, tenant detail boards/ConsoleTenant.dc.html
- Data scope: all tenants; never patient data without a consented support session

## Patient

- Home: boards/Portal.dc.html (mobile web, OTP login)
- Data scope: own and linked family records
