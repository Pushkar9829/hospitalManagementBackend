import { describe, expect, it } from 'vitest';
import { deliverEvents, signIn, useIntegration } from '../helpers/int.js';
import { wardHospital } from '../helpers/ward.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { Admission } from '../../src/modules/ipd/index.js';
import { onDischarged } from '../../src/modules/diet/services/diet.service.js';
import { Item, Store, addStock } from '../../src/modules/inventory/index.js';

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

    // Kitchen costing: no kitchen store yet, then food is issued oldest expiry first at cost.
    expect((await kitchen.get('/diet/kitchen/stock')).body.error.code).toBe('NO_KITCHEN_STORE');
    const { rice } = await runAsSystem(h.t.tenant._id, async () => {
      const [store] = await Store.create([{ code: 'KIT', name: 'Kitchen store', kind: 'KITCHEN' }]);
      const [item] = await Item.create([{ code: 'RICE', name: 'Rice', kind: 'FOOD', unit: 'kg' }]);
      for (const [batchNo, expiry, cost] of [
        ['R-NEW', '2099-12', 6000],
        ['R-OLD', '2099-01', 5000],
      ])
        await addStock({
          storeId: store._id,
          itemId: item._id,
          batchNo,
          expiry,
          mrp: cost,
          cost,
          qty: 10,
          kind: 'TRANSFER_IN',
          ref: 'TEST',
          by: 'test',
        });
      return { rice: String(item._id) };
    });
    expect((await kitchen.get('/diet/kitchen/stock')).body).toMatchObject({
      value: 10 * 6000 + 10 * 5000,
    });
    const used = await kitchen
      .post('/diet/kitchen/consumption')
      .send({ date: day, meal: 'LUNCH', lines: [{ itemId: rice, qty: 12 }] });
    expect(used.status, JSON.stringify(used.body)).toBe(201);
    // 10 kg from the batch expiring first at 50.00, then 2 kg at 60.00.
    expect(used.body.total).toBe(10 * 5000 + 2 * 6000);
    expect(
      (
        await kitchen
          .post('/diet/kitchen/consumption')
          .send({ date: day, lines: [{ itemId: rice, qty: 50 }] })
      ).body.error.code,
    ).toBe('INSUFFICIENT_STOCK');
    const cost = (await kitchen.get(`/diet/kitchen/costing?from=${day}&to=${day}`)).body;
    expect(cost).toMatchObject({
      cost: 62_000,
      trays: 1,
      perTray: 62_000,
      charged: 1,
      recovered: 15_000,
    });
    expect(cost.meals.find((m) => m.meal === 'LUNCH')).toMatchObject({ trays: 1, cost: 62_000 });
    expect(cost.topItems[0]).toMatchObject({ name: 'Rice', qty: 12 });
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
