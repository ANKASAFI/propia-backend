import { DataSource } from 'typeorm';
import { hashPassword } from './common';
import {
  Alert,
  Commitment,
  Complaint,
  Deposit,
  Movement,
  Notification,
  Offer,
  PayoutAccount,
  Property,
  Sequence,
  Setting,
  User,
  Vote,
  Wallet,
  Withdrawal,
} from './entities';

const PASS = 'Propia.2026';

export async function seedIfEmpty(db: DataSource) {
  const users = db.getRepository(User);
  if (await users.count()) return;
  const passwordHash = await hashPassword(PASS);

  const mk = (partial: Partial<User>) =>
    users.create({
      passwordHash,
      emailConfirmed: true,
      role: 'investor',
      userStatus: 'active',
      investorStatus: 'enabled',
      nationality: 'Peruana',
      isDomiciled: true,
      beneficialOwner: true,
      fundsDeclared: true,
      holderSigned: true,
      spouseSigned: true,
      onboardingStep: 4,
      ...partial,
    });

  const joel = await users.save(
    mk({
      email: 'joel.villanueva@email.com',
      firstName: 'Joel',
      lastName: 'Villanueva Torres',
      phone: '+51 987 112 233',
      documentType: 'DNI',
      documentNumber: '45128821',
      birthDate: '1988-08-14',
      address: 'Av. Pardo 610, dpto. 402',
      district: 'Miraflores, Lima',
      maritalStatus: 'casado',
      propertyRegime: 'gananciales',
      spouseName: 'María Fernanda Ruiz',
      spouseEmail: 'm.ruiz@email.com',
      fundsOrigin: 'sueldo',
      pep: false,
    }),
  );

  await users.save([
    mk({ email: 'lucia.ramos@propia.pe', firstName: 'Lucía', lastName: 'Ramos', role: 'tesoreria', investorStatus: 'enabled' }),
    mk({ email: 'diego.salas@propia.pe', firstName: 'Diego', lastName: 'Salas', role: 'operaciones', investorStatus: 'enabled' }),
    mk({ email: 'elena.vargas@propia.pe', firstName: 'Elena', lastName: 'Vargas', role: 'admin', investorStatus: 'enabled' }),
    mk({ email: 'marcos.quispe@propia.pe', firstName: 'Marcos', lastName: 'Quispe', role: 'cumplimiento', investorStatus: 'enabled' }),
    mk({
      email: 'ana.paredes@email.com',
      firstName: 'Ana Lucía',
      lastName: 'Paredes',
      documentType: 'DNI',
      documentNumber: '70123488',
      fundsOrigin: 'sueldo',
    }),
    mk({
      email: 'ricardo.mendoza@email.com',
      firstName: 'Ricardo',
      lastName: 'Mendoza',
      documentType: 'CE',
      documentNumber: '00112219',
      fundsOrigin: 'negocio',
    }),
    mk({
      email: 'carla.vasquez@email.com',
      firstName: 'Carla',
      lastName: 'Vásquez Ríos',
      documentType: 'DNI',
      documentNumber: '41000007',
      fundsOrigin: 'sueldo',
    }),
    mk({
      email: 'rosa.melendez@email.com',
      firstName: 'Rosa',
      lastName: 'Meléndez',
      documentType: 'CE',
      documentNumber: '00112244',
      isDomiciled: false,
      fundsOrigin: 'otro',
      fundsDetail: 'venta de vehículo',
      investorStatus: 'review',
      plaftAsk: 'Contrato de compraventa del vehículo',
      plaftFile: 'contrato-venta-auto.pdf',
      listOnu: true,
      createdAt: new Date('2026-10-06T12:00:00-05:00'),
    }),
    mk({
      email: 'hugo.salazar@email.com',
      firstName: 'Hugo',
      lastName: 'Salazar',
      documentType: 'DNI',
      documentNumber: '10223382',
      fundsOrigin: 'herencia',
      investorStatus: 'review',
      createdAt: new Date('2026-10-09T09:00:00-05:00'),
    }),
    mk({
      email: 'luis.paredes@email.com',
      firstName: 'Luis',
      lastName: 'Paredes',
      documentType: 'DNI',
      documentNumber: '44001119',
      fundsOrigin: 'sueldo',
      investorStatus: 'review',
      listOnu: true,
      listOfac: true,
      createdAt: new Date('2026-10-09T14:00:00-05:00'),
    }),
    mk({
      email: 'camila.rios@email.com',
      firstName: 'Camila',
      lastName: 'Ríos',
      documentType: 'DNI',
      documentNumber: '46770021',
      investorStatus: 'signing',
      onboardingStep: 4,
      maritalStatus: 'casado',
      propertyRegime: 'gananciales',
      spouseName: 'Martín Ríos',
      spouseEmail: 'martin.rios@email.com',
      fundsOrigin: 'sueldo',
      holderSigned: true,
      spouseSigned: false,
      envelopeId: '7F3A-21C9',
      signToken: 'local-camila',
      spouseToken: 'local-spouse-camila',
    }),
    mk({
      email: 'mateo.benavides@email.com',
      firstName: 'Mateo',
      lastName: 'Benavides',
      documentType: 'DNI',
      documentNumber: '40111222',
      fundsOrigin: 'ahorros',
    }),
    mk({
      email: 'sofia.salaverry@email.com',
      firstName: 'Sofía',
      lastName: 'Salaverry',
      documentType: 'DNI',
      documentNumber: '40998877',
      fundsOrigin: 'sueldo',
    }),
  ]);

  const byEmail = async (email: string) => users.findOneByOrFail({ email });
  const ana = await byEmail('ana.paredes@email.com');
  const ricardo = await byEmail('ricardo.mendoza@email.com');
  const carla = await byEmail('carla.vasquez@email.com');
  const mateo = await byEmail('mateo.benavides@email.com');
  const sofia = await byEmail('sofia.salaverry@email.com');

  const props = db.getRepository(Property);
  const rows: Array<Partial<Property>> = [
    { name: 'Edificio Alba', city: 'San Isidro, Lima', kind: 'Residencial', price: 480000, unitPrice: 24000, unitsTotal: 20, yieldPct: 9.8, status: 'funding', closeDate: '2026-10-31', monthlyExpenses: 1200, monthlyRent: 5100, gradient: 'g1', icon: 'building', notary: 'Notaría Paino · Lima', occupancy: '100%', contractUntil: 'dic 2028' },
    { name: 'Casa Terrazas del Sur', city: 'Barranco, Lima', kind: 'Renta mediana estadía', price: 320000, unitPrice: 16000, unitsTotal: 20, yieldPct: 8.4, status: 'funding', closeDate: '2026-11-15', monthlyExpenses: 800, monthlyRent: 3040, gradient: 'g2', icon: 'home', notary: 'Notaría Paino · Lima', occupancy: '100%', contractUntil: 'jun 2027' },
    { name: 'Oficina Vértice', city: 'Miraflores, Lima', kind: 'Oficinas corporativas', price: 600000, unitPrice: 30000, unitsTotal: 20, yieldPct: 10.5, status: 'sale_vote', closeDate: '2024-03-15', monthlyRent: 5900, monthlyExpenses: 650, gradient: 'g3', icon: 'building', notary: 'Notaría Paino · Lima', occupancy: '100%', contractUntil: 'mar 2028', salePrice: 680000, voteYes: 12, voteEnds: '2026-10-15', valuationPct: 4.5 },
    { name: 'Torre Pardo 540', city: 'Miraflores, Lima', kind: 'Residencial', price: 720000, unitPrice: 36000, unitsTotal: 20, yieldPct: 9.1, status: 'notary', closeDate: '2026-09-30', monthlyExpenses: 1500, gradient: 'g4', icon: 'building', notary: 'Notaría Paino · Lima', note: 'Firma 14 oct' },
    { name: 'Lofts Surquillo', city: 'Surquillo, Lima', kind: 'Residencial', price: 260000, unitPrice: 13000, unitsTotal: 20, yieldPct: 8.9, status: 'funding', closeDate: '2026-12-20', monthlyExpenses: 640, monthlyRent: 2570, gradient: 'g5', icon: 'home', notary: 'Notaría Paino · Lima', occupancy: '100%', contractUntil: 'dic 2027' },
    { name: 'Residencial Arequipa 1120', city: 'Lince, Lima', kind: 'Residencial', price: 410000, unitPrice: 20500, unitsTotal: 20, yieldPct: 8.6, status: 'draft', gradient: 'g4', icon: 'building' },
    { name: 'Dúplex Los Laureles', city: 'La Molina, Lima', kind: 'Residencial', price: 540000, unitPrice: 27000, unitsTotal: 20, yieldPct: 9.0, status: 'funded', gradient: 'g2', icon: 'home', note: 'Lista para notaría' },
    { name: 'Departamento Salaverry', city: 'Jesús María, Lima', kind: 'Residencial', price: 290000, unitPrice: 14500, unitsTotal: 20, yieldPct: 8.8, status: 'operating', monthlyRent: 2800, monthlyExpenses: 420, gradient: 'g2', icon: 'building', note: 'Inscrita · primera renta 1 nov' },
    { name: 'Casa Benavides', city: 'Surco, Lima', kind: 'Residencial', price: 380000, unitPrice: 19000, unitsTotal: 20, yieldPct: 9.2, status: 'operating', monthlyRent: 3400, monthlyExpenses: 530, gradient: 'g4', icon: 'home', note: 'US$ 2,870 al mes' },
    { name: 'Local Javier Prado', city: 'San Borja, Lima', kind: 'Local comercial', price: 410000, unitPrice: 20500, unitsTotal: 20, yieldPct: 9.4, status: 'selling', gradient: 'g5', icon: 'building', note: 'En venta · escritura 20 oct', salePrice: 410000 },
    { name: 'Depa Pezet', city: 'San Isidro, Lima', kind: 'Residencial', price: 350000, unitPrice: 17500, unitsTotal: 20, yieldPct: 8.7, status: 'sold', gradient: 'g1', icon: 'building', note: 'Vendida · repartida 2 sep', salePrice: 350000 },
    { name: 'Casa Chacarilla', city: 'Surco, Lima', kind: 'Residencial', price: 300000, unitPrice: 15000, unitsTotal: 20, yieldPct: 8.2, status: 'cancelled', gradient: 'g4', icon: 'home', note: 'La compra se cayó · 12 ago' },
  ];
  const savedProps = await props.save(rows.map((r) => props.create(r)));
  const prop = (name: string) => savedProps.find((p) => p.name === name);

  const cRepo = db.getRepository(Commitment);
  await cRepo.save([
    cRepo.create({ code: 'CMP-001187', userId: joel.id, propertyId: prop('Edificio Alba').id, units: 1, amount: 24000, status: 'active', createdAt: new Date('2026-09-14T11:00:00-05:00') }),
    cRepo.create({ code: 'CMP-001162', userId: joel.id, propertyId: prop('Casa Terrazas del Sur').id, units: 1, amount: 16000, status: 'active', createdAt: new Date('2026-09-10T11:00:00-05:00') }),
    cRepo.create({ code: 'CMP-000880', userId: joel.id, propertyId: prop('Oficina Vértice').id, units: 2, amount: 60000, status: 'owned', valuation: 62700, rentAccumulated: 9975, createdAt: new Date('2024-03-15T11:00:00-05:00') }),
    cRepo.create({ code: 'CMP-001204', userId: joel.id, propertyId: prop('Lofts Surquillo').id, units: 1, amount: 13000, status: 'pending_approval', createdAt: new Date('2026-10-09T11:05:00-05:00') }),
    cRepo.create({ code: 'CMP-000901', userId: mateo.id, propertyId: prop('Casa Benavides').id, units: 4, amount: 76000, status: 'owned', createdAt: new Date('2025-01-10T11:00:00-05:00') }),
    cRepo.create({ code: 'CMP-000902', userId: sofia.id, propertyId: prop('Departamento Salaverry').id, units: 3, amount: 43500, status: 'owned', createdAt: new Date('2025-06-01T11:00:00-05:00') }),
    cRepo.create({ code: 'CMP-000903', userId: mateo.id, propertyId: prop('Oficina Vértice').id, units: 1, amount: 30000, status: 'owned', createdAt: new Date('2024-04-02T11:00:00-05:00') }),
  ]);

  const fillerUsers = [];
  for (let i = 1; i <= 12; i++) {
    fillerUsers.push(
      await users.save(
        mk({
          email: `copropietario${i}@email.com`,
          firstName: 'Copropietario',
          lastName: String(i),
          documentType: 'DNI',
          documentNumber: String(80000000 + i),
          fundsOrigin: 'sueldo',
        }),
      ),
    );
  }
  const filler = [];
  const give = (name: string, indexes: number[], units: number, price: number) => {
    indexes.forEach((idx, n) => {
      filler.push(
        cRepo.create({
          code: `CMP-F${name.slice(0, 3)}${n}`,
          userId: fillerUsers[idx].id,
          propertyId: prop(name).id,
          units,
          amount: price * units,
          status: 'active',
        }),
      );
    });
  };
  // Alba: Joel 1 + 10 copropietarios = 14 unidades y 11 inversionistas.
  give('Edificio Alba', [0, 1, 2, 3, 4, 5, 6], 1, 24000);
  give('Edificio Alba', [7, 8, 9], 2, 24000);
  give('Casa Terrazas del Sur', [0, 1], 1, 16000);
  give('Casa Terrazas del Sur', [2, 3], 2, 16000);
  give('Lofts Surquillo', [5, 6, 10], 1, 13000);
  await cRepo.save(filler);

  const fondo = await users.save(mk({ email: 'fondo@propia.pe', firstName: 'Fondo', lastName: 'Semilla', documentType: 'DNI', documentNumber: '80000099', fundsOrigin: 'sueldo' }));
  const topUp: Array<[string, number, string, number]> = [
    ['Oficina Vértice', 17, 'owned', 30000],
    ['Torre Pardo 540', 20, 'active', 36000],
    ['Dúplex Los Laureles', 20, 'active', 27000],
    ['Departamento Salaverry', 17, 'owned', 14500],
    ['Casa Benavides', 16, 'owned', 19000],
    ['Local Javier Prado', 20, 'owned', 20500],
    ['Depa Pezet', 20, 'owned', 17500],
    ['Casa Chacarilla', 9, 'cancelled', 15000],
  ];
  await cRepo.save(topUp.map(([name, units, status, price], i) => cRepo.create({
    code: `CMP-T${String(i).padStart(4, '0')}`,
    userId: fondo.id,
    propertyId: prop(name).id,
    units,
    amount: price * units,
    status,
  })));

  await db.getRepository(Wallet).save([
    { userId: joel.id, currency: 'USD', available: 28500, settled: 30555, rentAccumulated: 9975 },
    { userId: joel.id, currency: 'PEN', available: 0, settled: 0, rentAccumulated: 0 },
    { userId: ana.id, currency: 'USD', available: 4200, settled: 0, rentAccumulated: 0 },
    { userId: ricardo.id, currency: 'PEN', available: 1500, settled: 0, rentAccumulated: 0 },
    { userId: carla.id, currency: 'USD', available: 800, settled: 0, rentAccumulated: 0 },
    { userId: mateo.id, currency: 'USD', available: 50000, settled: 0, rentAccumulated: 0 },
    { userId: sofia.id, currency: 'USD', available: 18000, settled: 0, rentAccumulated: 0 },
  ]);

  const movements = [
    ['2026-10-09T10:20:00-05:00', 'Retiro solicitado', 'RET-000214 · BCP ****8812', -5000],
    ['2026-10-01T09:00:00-05:00', 'Renta · Oficina Vértice', 'REN-2026-09', 525],
    ['2026-09-14T11:00:00-05:00', 'Compromiso · Edificio Alba', 'CMP-001187 · 1 unidad', -24000],
    ['2026-09-10T11:00:00-05:00', 'Compromiso · Casa Terrazas del Sur', 'CMP-001162 · 1 unidad', -16000],
    ['2026-09-08T15:00:00-05:00', 'Depósito validado', 'DEP-000731 · BBVA', 40000],
    ['2026-09-01T09:00:00-05:00', 'Renta · Oficina Vértice', 'REN-2026-08', 525],
    ['2026-08-01T09:00:00-05:00', 'Renta · Oficina Vértice', 'REN-2026-07', 525],
  ] as const;
  await db.getRepository(Movement).save(
    movements.map(([at, concept, reference, amount]) => ({
      userId: joel.id,
      currency: 'USD',
      concept,
      reference,
      amount,
      createdAt: new Date(at),
    })),
  );

  const payouts = db.getRepository(PayoutAccount);
  const bcp = await payouts.save(
    payouts.create({
      userId: joel.id,
      bank: 'BCP',
      accountType: 'Ahorros',
      currency: 'USD',
      accountNumber: '191998812',
      cci: '00219100999881200112',
      holder: 'Joel Villanueva Torres',
      createdAt: new Date('2024-03-12T10:00:00-05:00'),
    }),
  );
  await payouts.save(
    payouts.create({
      userId: joel.id,
      bank: 'Interbank',
      accountType: 'Ahorros',
      currency: 'PEN',
      accountNumber: '8983109873301',
      cci: '00389801310987330141',
      holder: 'Joel Villanueva Torres',
      createdAt: new Date(Date.now() - 3 * 3600000),
    }),
  );

  await db.getRepository(Deposit).save([
    { code: 'DEP-000742', userId: joel.id, amount: 10000, currency: 'USD', operationNumber: '004512398', originBank: 'BCP', originAccount: 'Ahorros ****8812', fileName: 'constancia-bcp.pdf', status: 'pending', createdAt: new Date('2026-10-09T10:42:00-05:00') },
    { code: 'DEP-000743', userId: ana.id, amount: 16000, currency: 'USD', operationNumber: '88120455', originBank: 'BBVA', originAccount: 'Ahorros ****4410', fileName: 'bbva.pdf', status: 'pending', createdAt: new Date('2026-10-09T09:15:00-05:00') },
    { code: 'DEP-000744', userId: ricardo.id, amount: 18500, currency: 'PEN', operationNumber: '004498712', originBank: 'BCP', originAccount: 'Ahorros ****2201', fileName: 'bcp-soles.pdf', status: 'pending', createdAt: new Date('2026-10-09T08:03:00-05:00') },
    { code: 'DEP-000745', userId: carla.id, amount: 12200, currency: 'USD', operationNumber: '88117302', originBank: 'BBVA', originAccount: 'Ahorros ****7781', fileName: 'bbva-2.pdf', status: 'pending', duplicate: true, createdAt: new Date('2026-10-08T18:47:00-05:00') },
  ]);

  await db.getRepository(Withdrawal).save([
    { code: 'RET-000214', userId: joel.id, payoutAccountId: bcp.id, amount: 5000, currency: 'USD', status: 'pending', createdAt: new Date('2026-10-09T10:20:00-05:00') },
    { code: 'RET-000215', userId: ana.id, payoutAccountId: bcp.id, amount: 2000, currency: 'USD', status: 'pending', createdAt: new Date('2026-10-09T08:10:00-05:00') },
  ]);

  await db.getRepository(Offer).save([
    { code: 'OFR-000311', propertyId: prop('Casa Benavides').id, sellerId: mateo.id, units: 1, price: 19400, referencePrice: 19000, status: 'open', createdAt: new Date('2026-09-20T10:00:00-05:00') },
    { code: 'OFR-000318', propertyId: prop('Departamento Salaverry').id, sellerId: sofia.id, units: 1, price: 14200, referencePrice: 14500, status: 'open', createdAt: new Date('2026-09-22T10:00:00-05:00') },
    { code: 'OFR-000320', propertyId: prop('Casa Benavides').id, sellerId: mateo.id, units: 2, price: 38500, referencePrice: 38000, status: 'open', createdAt: new Date('2026-09-25T10:00:00-05:00') },
    { code: 'OFR-000301', propertyId: prop('Oficina Vértice').id, sellerId: joel.id, buyerId: mateo.id, units: 1, price: 31500, referencePrice: 30000, status: 'retracto', reserved: false, windowEnds: new Date('2026-09-25T10:00:00-05:00'), retractoEnds: new Date('2026-11-01T23:59:00-05:00'), createdAt: new Date('2026-09-18T10:00:00-05:00') },
  ]);

  await db.getRepository(Vote).save({ propertyId: prop('Oficina Vértice').id, userId: joel.id, choice: 'yes' });

  await db.getRepository(Notification).save([
    { userId: joel.id, title: 'Depósito en revisión', body: 'US$ 10,000.00 · BCP · hoy 10:42', read: false },
    { userId: joel.id, title: 'Solicitud enviada', body: 'Lofts Surquillo · 1 unidad · US$ 13,000.00', read: false },
    { userId: joel.id, title: 'Renta acreditada', body: 'Oficina Vértice · US$ 525.00 · 1 oct', read: false },
    { userId: joel.id, title: 'Votación abierta', body: 'Oficina Vértice · oferta US$ 680,000 · cierra el 15 oct', read: true },
  ]);

  await db.getRepository(Complaint).save({
    code: 'R-2026-000014',
    name: 'Ana Lucía Paredes',
    email: 'ana.paredes@email.com',
    document: 'DNI 70123488',
    kind: 'queja',
    service: 'Retiro',
    detail: 'Queja por demora en un retiro.',
    request: 'Que paguen el retiro esta semana.',
    status: 'open',
    createdAt: new Date('2026-09-27T10:00:00-05:00'),
  });

  await db.getRepository(Alert).save([
    { title: 'N.º de operación repetido', detail: 'DEP-000745 · Carla Vásquez · 88117302 ya apareció en otro depósito.', severity: 'alta', status: 'open' },
    { title: 'Evaluación PLAFT sin atender', detail: 'Rosa Meléndez lleva más de 48 horas en evaluación.', severity: 'media', status: 'open' },
  ]);

  await db.getRepository(Setting).save([
    { key: 'secondary_window_days', value: '7' },
    { key: 'retracto_days', value: '30' },
    { key: 'commission_pct', value: '3' },
    { key: 'closing_cost_usd', value: '750' },
    { key: 'closing_cost_pen', value: '2800' },
    { key: 'double_approval_usd', value: '' },
  ]);

  await db.getRepository(Sequence).save([
    { name: 'CMP', value: 1204 },
    { name: 'DEP', value: 745 },
    { name: 'RET', value: 215 },
    { name: 'OFR', value: 320 },
    { name: 'R', value: 14 },
  ]);
}
