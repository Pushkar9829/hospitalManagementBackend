/**
 * OPD demo data for the development hospital (called by seed-dev.js; safe to run again):
 * departments, six doctors with consultation and follow-up fees, the orderable tests, weekly
 * schedules, a few patients and today's bookings, some checked in and triaged.
 * The "doctor" login is Dr. Meera Iyer; the "clinic" login is Dr. R. Menon (clinic desk).
 */
import { patientCreateInput } from '@hms/shared/schemas';
import { runAsSystem } from '../src/core/tenancy/context.js';
import { User } from '../src/core/auth/models/user.model.js';
import { Department, Doctor, PriceList, Service, TaxCode } from '../src/modules/setup/index.js';
import { Patient } from '../src/modules/patients/index.js';
import { registerPatient } from '../src/modules/patients/services/patients.service.js';
import { ORDERABLE_ROWS } from '../src/modules/opd/data/clinical.js';
import { Appointment, DoctorSchedule, OpdSettings } from '../src/modules/opd/models/opd.models.js';
import { book, checkIn } from '../src/modules/opd/services/appointment.service.js';
import { saveVitals } from '../src/modules/opd/services/visit.service.js';
import { settingsDoc } from '../src/modules/opd/services/settings.service.js';

const DEPTS = [
  ['CARD', 'Cardiology'],
  ['ORTH', 'Orthopaedics'],
  ['PAED', 'Paediatrics'],
  ['DERM', 'Dermatology'],
  ['GMED', 'General Medicine'],
  ['GYN', 'Gynaecology'],
];
/** [code, name, dept, room, new fee, follow-up fee (rupees), login] */
const DOCTORS = [
  ['DMI', 'Dr. Meera Iyer', 'CARD', '12', 800, 500, 'doctor'],
  ['DPJ', 'Dr. P. Joshi', 'ORTH', '7', 700, 400],
  ['DAT', 'Dr. A. Thomas', 'PAED', '3', 600, 300],
  ['DLG', 'Dr. L. Gupta', 'DERM', '9', 700, 400],
  ['DRM', 'Dr. R. Menon', 'GMED', '5', 600, 400, 'clinic'],
  ['DFK', 'Dr. F. Khan', 'GYN', '10', 700, 500],
];
const PATIENTS = [
  ['Ravi', 'Kumar', 'M', 47, '9820012345', 'Penicillin'],
  ['Divya', 'Rao', 'F', 29, '9820012346'],
  ['Harish', 'Verma', 'M', 44, '9820012347'],
  ['Neeta', 'Shah', 'F', 52, '9820012348'],
  ['Suresh', 'Patil', 'M', 61, '9820012349'],
  ['Myra', 'Khan', 'F', 8, '9820012350'],
  ['Rekha', 'Nair', 'F', 34, '9820012351'],
  ['Sunil', 'Desai', 'M', 39, '9820012352'],
];
const CATEGORY = { LAB: 'LAB', RAD: 'RAD', PROC: 'PROCEDURE' };
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const session = (start, end, room, extra = {}) => ({
  start,
  end,
  room,
  slotNew: 10,
  slotFollowUp: 5,
  max: 18,
  overbook: 1,
  online: true,
  tele: false,
  ...extra,
});

/** Patients and today's bookings; the first few checked in and triaged. */
async function demoBookings() {
  const patients = [];
  for (const [first, last, gender, age, mobile, allergy] of PATIENTS) {
    const found = await Patient.findOne({ mobile, 'name.first': first }).lean();
    if (found) {
      patients.push({ id: String(found._id) });
      continue;
    }
    patients.push(
      await registerPatient(
        patientCreateInput.parse({
          registrationType: 'QUICK',
          name: { first, last },
          gender,
          mobile,
          birth: { age: { years: age } },
          allergies: allergy ? [{ substance: allergy, severity: 'SEVERE' }] : [],
          noKnownAllergies: !allergy,
          confirmNotDuplicate: true,
        }),
      ),
    );
  }

  // Today: bookings across the doctors; the first few are checked in and triaged.
  const doctors = await Doctor.find({ code: { $in: DOCTORS.map((d) => d[0]) } }).lean();
  const byCode = Object.fromEntries(doctors.map((d) => [d.code, d]));
  const plan = [
    [0, 'DMI', '09:00', 'FOLLOW_UP', 'triage'],
    [1, 'DMI', '09:10', 'NEW', 'triage'],
    [2, 'DMI', '09:20', 'NEW', 'checkin'],
    [3, 'DPJ', '09:00', 'NEW', 'checkin'],
    [4, 'DRM', '09:00', 'FOLLOW_UP', 'triage'],
    [5, 'DAT', '09:30', 'NEW', 'book'],
    [6, 'DLG', '10:00', 'FOLLOW_UP', 'book'],
    [7, 'DRM', '09:10', 'NEW', 'book'],
  ];
  for (const [p, doc, time, visitType, state] of plan) {
    try {
      const a = await book({
        patientId: patients[p].id,
        doctorId: byCode[doc]._id,
        time,
        visitType,
        channel: 'DESK',
      });
      if (state === 'book') continue;
      const ci = await checkIn(a.id, { detailsConfirmed: true });
      if (state === 'triage' && ci.visit.stage === 'WAITING')
        await saveVitals(ci.visit.id, {
          bp: p === 0 ? '148/92' : '118/76',
          pulse: 84,
          tempF: 98.4,
          spo2: 97,
          weightKg: 70,
          heightCm: 170,
          complaint:
            p === 0 ? 'Chest tightness on climbing stairs, 2 weeks' : 'Fever with body ache',
          priority: p === 0 ? 'AMBER' : 'GREEN',
        });
    } catch (e) {
      // A slot may already be booked when the seed runs again on the same day.
      if (!['SLOT_TAKEN', 'TOO_MANY_BOOKINGS'].includes(e?.code)) throw e;
    }
  }
}

export async function seedOpdDemo({ tenant, branch }) {
  return runAsSystem(
    tenant._id,
    async () => {
      if (await Doctor.exists({ code: 'DMI' })) {
        if (await Appointment.exists({})) return false;
        // A run stopped before the bookings (it was a Sunday): open Sunday mornings, then book.
        for (const sch of await DoctorSchedule.find()) {
          const sun = sch.week.find((d) => d.day === 'SUN');
          const room = sch.week.find((d) => d.sessions.length)?.sessions[0]?.room ?? '';
          if (sun && !sun.sessions.length) {
            sun.sessions = [session('09:00', '13:00', room)];
            await sch.save();
          }
        }
        await demoBookings();
        return true;
      }
      const general = await PriceList.findOne({ code: 'GENERAL' }).lean();
      const exempt = await TaxCode.findOne({ code: 'EXEMPT' }).lean();
      const service = async (code, name, category, rupees) =>
        (await Service.findOne({ code }).lean()) ??
        (
          await Service.create([
            {
              code,
              name,
              category,
              taxCodeId: exempt._id,
              status: 'ACTIVE',
              isActive: true,
              rates: [{ priceListId: general._id, amount: rupees * 100 }],
            },
          ])
        )[0];
      const depts = {};
      for (const [code, name] of DEPTS)
        depts[code] =
          (await Department.findOne({ code }).lean()) ??
          (
            await Department.create([
              {
                code,
                name,
                type: 'CLINICAL',
                status: 'ACTIVE',
                services: { opd: true },
                location: { branchId: branch._id },
              },
            ])
          )[0];
      for (const [code, name, type, price] of ORDERABLE_ROWS)
        await service(code, name, CATEGORY[type] ?? 'PROCEDURE', price);

      for (const [code, name, dept, room, fee, fuFee, login] of DOCTORS) {
        const cons = await service(`CON${code}`, `Consultation ${name}`, 'CONSULTATION', fee);
        const fu = await service(`CFU${code}`, `Follow-up ${name}`, 'CONSULTATION', fuFee);
        const user = login ? await User.findOne({ username: login }).lean() : null;
        const [doctor] = await Doctor.create([
          {
            code,
            name,
            kind: 'CONSULTANT',
            departmentId: depts[dept]._id,
            registrationNo: `MMC-${20000 + DOCTORS.findIndex((d) => d[0] === code)}`,
            userId: user?._id,
            consultationServiceId: cons._id,
          },
        ]);
        await DoctorSchedule.create([
          {
            doctorId: doctor._id,
            week: DAYS.map((day) => ({
              day,
              sessions:
                // The demo hospital is open on Sunday mornings, so a demo shows bookings any day.
                day === 'SUN'
                  ? [session('09:00', '13:00', room)]
                  : [
                      session('09:00', '13:00', room),
                      ...(day !== 'SAT'
                        ? [session('16:00', '20:00', room, { tele: day === 'WED' })]
                        : []),
                    ],
            })),
            feeServices: { NEW: cons._id, FOLLOW_UP: fu._id, TELE: cons._id },
            followUp: { days: 15, visits: 1 },
          },
        ]);
      }
      const s = await settingsDoc();
      s.booking.triageRequired = ['Cardiology', 'General Medicine', 'Paediatrics'];
      await s.save();

      await demoBookings();
      return true;
    },
    { branchId: String(branch._id) },
  );
}

export { OpdSettings };
