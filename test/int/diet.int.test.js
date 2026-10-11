import { describe, expect, it } from 'vitest';
import { deliverEvents, signIn, useIntegration } from '../helpers/int.js';
import { wardHospital } from '../helpers/ward.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { Admission } from '../../src/modules/ipd/index.js';
import { onDischarged } from '../../src/modules/diet/services/diet.service.js';

const ctx = useIntegration();
const DAY = 86_400_000;
const tomorrow = () => new Date(Date.now() + 330 * 60_000 + DAY).toISOString().slice(0, 10);

describe('Diet and kitchen (Phase 6)', () => {
  it('orders diets, holds NBM trays, prepares, delivers and charges private-room meals', async () => {
    const h = await wardHospital(ctx, {
      modules: ['DIET'],
      users: [
        ['kitchen', 'kitchen'],
        ['nurse', 'nurse'],
      ],
      services: [
        ['DIET-MEAL', 'Patient meal (private room)', 'OTHER', 15000],
        ['DIET-ATTENDANT', 'Attendant meal', 'OTHER', 10000],
      ],
    });
    const general = await h.admit('Arun', 'GW-01');
    const priv = await h.admit('Bina', 'PW-01', 'F');
    await deliverEvents(h.t.tenant._id); // ipd.admitted -> default diet
    const doc = await signIn(ctx.app, h.t.host, 'doc');
    const kitchen = await signIn(ctx.app, h.t.host, 'kitchen');
    const nurse = await signIn(ctx.app, h.t.host, 'nurse');

    const orders = (await kitchen.get('/diet/orders')).body.items;
    expect(orders.map((o) => o.diet)).toEqual(['NORMAL', 'NORMAL']);
    expect(orders.every((o) => o.source === 'DEFAULT')).toBe(true);

    // The doctor orders a diabetic diet with attendant meals; an unknown diet is refused
    expect((await doc.put(`/diet/orders/${priv.id}`).send({ diet: 'KETO' })).status).toBe(422);
    const dm = await doc
      .put(`/diet/orders/${priv.id}`)
      .send({ diet: 'diabetic', special: 'No sugar in tea', attendantMeals: true });
    expect(dm.status, JSON.stringify(dm.body)).toBe(200);
    expect(dm.body).toMatchObject({ diet: 'DIABETIC', source: 'DOCTOR', ward: 'Private Wing' });

    // Nil by mouth for the general-ward patient over tomorrow's lunch
    const day = tomorrow();
    const nbm = await nurse.post(`/diet/orders/${general.id}/nbm`).send({
      from: `${day}T06:00:00+05:30`,
      to: `${day}T14:00:00+05:30`,
      reason: 'Endoscopy',
    });
    expect(nbm.status, JSON.stringify(nbm.body)).toBe(200);
    // a later diet change keeps the NBM window
    const soft = await doc.put(`/diet/orders/${general.id}`).send({ diet: 'SOFT' });
    expect(soft.body.nbm.reason).toBe('Endoscopy');

    const sheet = (await kitchen.get(`/diet/production?date=${day}&meal=LUNCH`)).body;
    expect(sheet).toMatchObject({ total: 1, held: 1, attendants: 1, prepared: false });
    expect(sheet.byDiet).toEqual([
      { diet: 'DIABETIC', name: 'Diabetic', total: 1, wards: { 'Private Wing': 1 } },
    ]);
    expect(sheet.trays.find((t) => t.nbm)).toMatchObject({
      patient: 'Arun Kumar',
      nbmReason: 'Endoscopy',
    });

    const prep = (await kitchen.post('/diet/production/prepare').send({ date: day, meal: 'LUNCH' }))
      .body;
    expect(prep.items.map((t) => t.status).sort()).toEqual(['NBM', 'PREPARED']);
    await kitchen.post('/diet/production/prepare').send({ date: day, meal: 'LUNCH' });
    expect((await kitchen.get(`/diet/trays?date=${day}&meal=LUNCH`)).body.items).toHaveLength(2);

    // The general ward has only a held tray; the private wing's tray is delivered and charged
    expect(
      (
        await nurse
          .post('/diet/trays/deliver')
          .send({ date: day, meal: 'LUNCH', ward: 'General Ward' })
      ).body.delivered,
    ).toBe(0);
    const del = await nurse
      .post('/diet/trays/deliver')
      .send({ date: day, meal: 'LUNCH', ward: 'Private Wing' });
    expect(del.body.delivered).toBe(1);
    const trays = (await kitchen.get(`/diet/trays?date=${day}&meal=LUNCH`)).body.items;
    expect(trays.find((t) => t.status === 'DELIVERED')).toMatchObject({
      charged: true,
      deliveredBy: 'User nurse',
    });
    const charges = await runAsSystem(h.t.tenant._id, async () =>
      (await Admission.findById(priv.id).lean()).charges.map((c) => c.name),
    );
    expect(charges).toEqual(['Patient meal (private room)', 'Attendant meal']);
    const generalCharges = await runAsSystem(
      h.t.tenant._id,
      async () => (await Admission.findById(general.id).lean()).charges,
    );
    expect(generalCharges).toHaveLength(0);
    const billing = (await kitchen.get(`/diet/billing?date=${day}`)).body;
    expect(billing).toMatchObject({ mealRate: 15000, attendantRate: 10000, total: 25000 });
    expect(billing.items).toEqual([
      expect.objectContaining({ admissionId: priv.id, meals: 1, attendantMeals: 1, amount: 25000 }),
    ]);

    // Diet master: energy, restrictions and the menu per meal round-trip through settings
    const settings = (await kitchen.get('/diet/settings')).body;
    const diets = settings.diets.map((d) =>
      d.code === 'DIABETIC'
        ? {
            ...d,
            calories: 1800,
            restrictions: 'No sugar, low GI',
            menu: { BREAKFAST: 'Oats, milk without sugar' },
          }
        : d,
    );
    expect((await kitchen.put('/diet/settings').send({ diets })).status).toBe(200);
    const saved = (await kitchen.get('/diet/settings')).body.diets.find(
      (d) => d.code === 'DIABETIC',
    );
    expect(saved).toMatchObject({
      calories: 1800,
      menu: { BREAKFAST: 'Oats, milk without sugar' },
    });

    // Dinner after the NBM ends: the tray is prepared, then reported missed
    const dinner = (
      await kitchen.post('/diet/production/prepare').send({ date: day, meal: 'DINNER' })
    ).body.items.find((t) => t.patient === 'Arun Kumar');
    expect(dinner.status).toBe('PREPARED');
    const missed = await nurse
      .post(`/diet/trays/${dinner.id}/missed`)
      .send({ reason: 'Patient in radiology' });
    expect(missed.body.status).toBe('MISSED');
    expect((await kitchen.get(`/diet/missed?date=${day}`)).body.items).toHaveLength(1);

    // Dietitian's assessment with BMI
    const note = await kitchen.post(`/diet/notes/${priv.id}`).send({
      kind: 'ASSESSMENT',
      heightCm: 160,
      weightKg: 72,
      risk: 'MEDIUM',
      kcal: 1600,
      text: 'Type 2 diabetes; 1600 kcal, 6 small meals',
    });
    expect(note.status).toBe(201);
    expect(note.body.data.bmi).toBe(28.1);

    // Settings guard; discharge ends the order
    expect((await kitchen.put('/diet/settings').send({ defaultDiet: 'NOPE' })).status).toBe(422);
    await runAsSystem(h.t.tenant._id, () => onDischarged({ admissionId: priv.id }));
    expect((await kitchen.get('/diet/orders')).body.items.map((o) => o.patient)).toEqual([
      'Arun Kumar',
    ]);
  });
});
