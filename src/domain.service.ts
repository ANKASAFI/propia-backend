import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { checkPassword, code6, COMMIT, daysLeft, fmtDate, fmtWhen, hashPassword, INVESTOR, mask, money, OFFER, readSession, STATUS, strongPassword, ageLabel } from './common';
import {
  Alert, Commitment, Complaint, Deposit, Movement, Notification, Offer, PayoutAccount,
  Property, Retracto, RentRun, Sequence, Setting, User, Vote, Wallet, Withdrawal,
} from './entities';
import { seedIfEmpty } from './seed';

const ROLE: Record<string, string> = {
  investor: 'Inversionista',
  tesoreria: 'Tesorería',
  operaciones: 'Operaciones',
  cumplimiento: 'Cumplimiento',
  admin: 'Admin',
};

const BANKS = {
  USD: { bank: 'BCP · corriente dólares', account: '191-2345678-0-12', cci: '002-191-002345678012-45', holder: 'PROPIA SAC', ruc: '20601234567' },
  PEN: { bank: 'BCP · corriente soles', account: '191-8765432-0-09', cci: '002-191-008765432009-33', holder: 'PROPIA SAC', ruc: '20601234567' },
};

@Injectable()
export class DomainService implements OnModuleInit {
  constructor(private db: DataSource) {}

  async onModuleInit() {
    await seedIfEmpty(this.db);
  }

  private users() { return this.db.getRepository(User); }

  async userFromToken(token?: string) {
    const id = readSession(token);
    if (!id) return null;
    return this.users().findOneBy({ id });
  }

  require(user: User | null): User {
    if (!user) throw new UnauthorizedException('Tu sesión terminó. Vuelve a entrar.');
    if (user.userStatus !== 'active') throw new ForbiddenException('No puedes entrar con esta cuenta.');
    return user;
  }

  staff(user: User, roles: string[]) {
    this.require(user);
    if (user.role !== 'admin' && !roles.includes(user.role)) {
      throw new ForbiddenException('Esta sección no es para tu rol.');
    }
    return user;
  }

  private name(u: Pick<User, 'firstName' | 'lastName' | 'email'>) {
    return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
  }

  private initials(u: User) {
    const a = (u.firstName || u.email || '?').trim()[0] || '?';
    const b = (u.lastName || '').trim()[0] || '';
    return (a + b).toUpperCase();
  }

  presentUser(u: User) {
    const [label, cls] = INVESTOR[u.investorStatus] || ['', 'b-gray'];
    return {
      id: u.id,
      email: u.email,
      role: u.role,
      roleLabel: ROLE[u.role] || u.role,
      userStatus: u.userStatus,
      investorStatus: u.investorStatus,
      investorLabel: label,
      investorClass: cls,
      name: this.name(u),
      initials: this.initials(u),
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone,
      documentType: u.documentType,
      documentNumber: u.documentNumber,
      birthDate: u.birthDate,
      address: u.address,
      district: u.district,
      nationality: u.nationality,
      isDomiciled: u.isDomiciled,
      maritalStatus: u.maritalStatus,
      propertyRegime: u.propertyRegime,
      spouseName: u.spouseName,
      spouseEmail: u.spouseEmail,
      fundsOrigin: u.fundsOrigin,
      fundsDetail: u.fundsDetail,
      pep: u.pep,
      pepDetail: u.pepDetail,
      beneficialOwner: u.beneficialOwner,
      fundsDeclared: u.fundsDeclared,
      onboardingStep: u.onboardingStep,
      holderSigned: u.holderSigned,
      spouseSigned: u.spouseSigned,
      envelopeId: u.envelopeId,
      spouseToken: u.spouseToken,
      plaftNote: u.plaftNote,
      plaftAsk: u.plaftAsk,
      plaftFile: u.plaftFile,
      needsSpouse: u.propertyRegime === 'gananciales' || u.maritalStatus === 'conviviente',
    };
  }

  async me(user: User) {
    const unread = await this.db.getRepository(Notification).count({ where: { userId: user.id, read: false } });
    const counts = await this.counts();
    return { user: this.presentUser(user), unread, counts };
  }

  async counts() {
    const dep = await this.db.getRepository(Deposit).count({ where: { status: 'pending' } });
    const ret = await this.db.getRepository(Withdrawal).count({ where: { status: 'pending' } });
    const plaft = await this.users().count({ where: { investorStatus: In(['review', 'observed']) } });
    const alerts = await this.db.getRepository(Alert).count({ where: { status: 'open' } });
    const complaints = await this.db.getRepository(Complaint).count({ where: { status: 'open' } });
    const offers = await this.db.getRepository(Offer).count({ where: { status: In(['buyer_found', 'retracto', 'notary']) } });
    const commits = await this.db.getRepository(Commitment).count({ where: { status: 'pending_approval' } });
    return {
      depositos: dep,
      retiros: ret,
      plaft,
      alertas: alerts,
      reclamaciones: complaints,
      ofertas: offers,
      tablero: commits + complaints + plaft,
    };
  }

  async signup(email: string, password: string, terms: boolean, privacy: boolean) {
    email = (email || '').trim().toLowerCase();
    if (!email.includes('@')) throw new BadRequestException('Escribe un correo válido.');
    if (!strongPassword(password)) throw new BadRequestException('La contraseña necesita 12 caracteres, una mayúscula, un número y un símbolo.');
    if (!terms || !privacy) throw new BadRequestException('Acepta los términos y la política de privacidad.');
    if (await this.users().findOneBy({ email })) throw new BadRequestException('Ese correo ya tiene una cuenta. Inicia sesión.');
    const confirmCode = code6();
    const user = await this.users().save(this.users().create({
      email, passwordHash: await hashPassword(password), confirmCode, emailConfirmed: false, role: 'investor', investorStatus: 'onboarding',
    }));
    return { email: user.email, devCode: confirmCode };
  }

  async confirm(email: string, code: string) {
    const user = await this.users().findOneBy({ email: (email || '').trim().toLowerCase() });
    if (!user || user.confirmCode !== code) throw new BadRequestException('El código no es válido.');
    user.emailConfirmed = true;
    user.confirmCode = null;
    await this.users().save(user);
    return this.presentUser(user);
  }

  async login(email: string, password: string) {
    const user = await this.users().findOneBy({ email: (email || '').trim().toLowerCase() });
    if (!user || !(await checkPassword(password || '', user.passwordHash))) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }
    if (!user.emailConfirmed) throw new ForbiddenException('Confirma tu correo para entrar.');
    if (user.userStatus !== 'active') throw new ForbiddenException('No puedes entrar con esta cuenta.');
    return user;
  }

  async forgot(email: string) {
    const user = await this.users().findOneBy({ email: (email || '').trim().toLowerCase() });
    if (!user) return { ok: true };
    user.resetCode = code6();
    await this.users().save(user);
    return { ok: true, devCode: user.resetCode };
  }

  async reset(email: string, code: string, password: string) {
    const user = await this.users().findOneBy({ email: (email || '').trim().toLowerCase() });
    if (!user || user.resetCode !== code) throw new BadRequestException('El código no es válido.');
    if (!strongPassword(password)) throw new BadRequestException('La contraseña necesita 12 caracteres, una mayúscula, un número y un símbolo.');
    user.passwordHash = await hashPassword(password);
    user.resetCode = null;
    await this.users().save(user);
    return { ok: true };
  }

  async saveProfile(user: User, body: Partial<User> & { step?: number }) {
    const fields = ['firstName', 'lastName', 'phone', 'documentType', 'documentNumber', 'birthDate', 'address', 'district', 'nationality', 'isDomiciled', 'maritalStatus', 'propertyRegime', 'spouseName', 'spouseEmail', 'fundsOrigin', 'fundsDetail', 'pep', 'pepDetail', 'beneficialOwner', 'fundsDeclared'] as const;
    if (body.birthDate) {
      const age = (Date.now() - new Date(body.birthDate).getTime()) / (365.25 * 86400000);
      if (age < 18) throw new BadRequestException('Debes ser mayor de 18 años para invertir.');
    }
    for (const f of fields) if (body[f] !== undefined) (user as any)[f] = body[f];
    const step = Number(body.step ?? user.onboardingStep);
    user.onboardingStep = Math.max(user.onboardingStep, step);
    if (user.investorStatus === 'onboarding' && step >= 3 && user.fundsDeclared) user.investorStatus = 'signing';
    if (user.investorStatus === 'observed' && body.plaftFile) {
      user.plaftFile = body.plaftFile;
      user.investorStatus = 'review';
    }
    await this.users().save(user);
    return this.presentUser(user);
  }

  async startSignature(user: User) {
    if (!user.firstName || !user.documentNumber || !user.fundsDeclared) {
      throw new BadRequestException('Completa tu perfil, tu estado civil y el origen de fondos antes de firmar.');
    }
    user.investorStatus = 'signing';
    user.envelopeId = user.envelopeId || `LOCAL-${user.id.slice(0, 8).toUpperCase()}`;
    user.signToken = user.signToken || `holder-${user.id.slice(0, 8)}`;
    if (user.propertyRegime === 'gananciales' || user.maritalStatus === 'conviviente') {
      if (!user.spouseEmail) throw new BadRequestException('Falta el correo de tu cónyuge.');
      user.spouseToken = user.spouseToken || `spouse-${user.id.slice(0, 8)}`;
    } else {
      user.spouseSigned = true;
      user.spouseToken = null;
    }
    await this.users().save(user);
    return { envelopeId: user.envelopeId, signToken: user.signToken, spouseToken: user.spouseToken };
  }

  async sign(token: string, who: 'holder' | 'spouse') {
    const field = who === 'spouse' ? 'spouseToken' : 'signToken';
    const user = await this.users().findOneBy({ [field]: token });
    if (!user) throw new NotFoundException('No encontramos ese documento.');
    if (who === 'spouse') user.spouseSigned = true;
    else user.holderSigned = true;
    const spouseOk = user.spouseSigned || !(user.propertyRegime === 'gananciales' || user.maritalStatus === 'conviviente');
    if (user.holderSigned && spouseOk && ['signing', 'onboarding'].includes(user.investorStatus)) {
      user.investorStatus = 'review';
      await this.notify(user.id, 'Perfil en evaluación', 'Firmó todo el mundo. Cumplimiento revisa tu información.');
    }
    await this.users().save(user);
    return this.presentUser(user);
  }

  private async setting(key: string, fallback: string) {
    const row = await this.db.getRepository(Setting).findOneBy({ key });
    return row?.value ?? fallback;
  }

  private async nextCode(m: EntityManager, name: string, prefix: string) {
    let seq = await m.findOne(Sequence, { where: { name }, lock: { mode: 'pessimistic_write' } });
    if (!seq) {
      seq = await m.save(Sequence, m.create(Sequence, { name, value: 1000 }));
      seq = await m.findOne(Sequence, { where: { name }, lock: { mode: 'pessimistic_write' } });
    }
    seq.value += 1;
    await m.save(Sequence, seq);
    return `${prefix}-${String(seq.value).padStart(6, '0')}`;
  }

  private async filledMap() {
    const rows = await this.db.getRepository(Commitment).find({ where: { status: In(['active', 'owned']) } });
    const map = new Map<string, { units: number; people: Set<string> }>();
    for (const c of rows) {
      const cur = map.get(c.propertyId) || { units: 0, people: new Set<string>() };
      cur.units += c.units;
      cur.people.add(c.userId);
      map.set(c.propertyId, cur);
    }
    return map;
  }

  presentProperty(p: Property, fill?: { units: number; people: Set<string> }, mine = 0) {
    const [statusLabel, statusClass] = STATUS[p.status] || [p.status, 'b-gray'];
    const filled = fill?.units || 0;
    return {
      id: p.id,
      name: p.name,
      city: p.city,
      kind: p.kind,
      currency: p.currency,
      price: p.price,
      unitPrice: p.unitPrice,
      unitsTotal: p.unitsTotal,
      filled,
      investors: fill?.people.size || 0,
      yieldPct: Number(p.yieldPct),
      status: p.status,
      statusLabel,
      statusClass,
      gradient: p.gradient,
      icon: p.icon,
      closeDate: p.closeDate,
      closeLabel: p.closeDate ? fmtDate(p.closeDate) : '—',
      leftLabel: p.status === 'funding' ? daysLeft(p.closeDate) : '—',
      monthlyRent: p.monthlyRent,
      monthlyExpenses: p.monthlyExpenses,
      netRent: Math.round((Number(p.monthlyRent) - Number(p.monthlyExpenses)) * 100) / 100,
      notary: p.notary,
      occupancy: p.occupancy,
      contractUntil: p.contractUntil,
      note: p.note,
      salePrice: p.salePrice,
      voteYes: p.voteYes,
      voteEnds: p.voteEnds,
      valuationPct: Number(p.valuationPct),
      mine,
      priceLabel: money(p.price, p.currency),
      unitLabel: money(p.unitPrice, p.currency),
    };
  }

  async properties(user: User | null, status?: string) {
    const all = await this.db.getRepository(Property).find({ order: { createdAt: 'ASC' } });
    const fill = await this.filledMap();
    const mine = new Map<string, number>();
    if (user) {
      const own = await this.db.getRepository(Commitment).find({ where: { userId: user.id, status: In(['active', 'owned', 'pending_approval']) } });
      for (const c of own) mine.set(c.propertyId, (mine.get(c.propertyId) || 0) + (c.status === 'pending_approval' ? 0 : c.units));
    }
    return all
      .filter((p) => !status || p.status === status)
      .filter((p) => user?.role !== 'investor' || !['draft'].includes(p.status))
      .map((p) => this.presentProperty(p, fill.get(p.id), mine.get(p.id) || 0));
  }

  async property(user: User | null, id: string) {
    const p = await this.db.getRepository(Property).findOneBy({ id });
    if (!p) throw new NotFoundException('No encontramos ese inmueble.');
    const fill = await this.filledMap();
    const mineRows = user
      ? await this.db.getRepository(Commitment).find({ where: { userId: user.id, propertyId: id }, order: { createdAt: 'DESC' } })
      : [];
    const mine = mineRows.filter((c) => c.status === 'active' || c.status === 'owned').reduce((s, c) => s + c.units, 0);
    const pending = mineRows.find((c) => c.status === 'pending_approval') || null;
    let myVote = null;
    if (user) myVote = await this.db.getRepository(Vote).findOneBy({ userId: user.id, propertyId: id });
    return {
      ...this.presentProperty(p, fill.get(p.id), mine),
      pending: pending ? { id: pending.id, code: pending.code, units: pending.units, amount: pending.amount, label: money(pending.amount, pending.currency, true), at: fmtWhen(pending.createdAt) } : null,
      myVote: myVote?.choice || null,
    };
  }

  async createCommitment(user: User, propertyId: string, units: number) {
    if (user.role !== 'investor' || user.investorStatus !== 'enabled') {
      throw new ForbiddenException('Tu cuenta todavía no está habilitada para invertir.');
    }
    units = Math.floor(Number(units));
    if (units < 1) throw new BadRequestException('Elige al menos una unidad.');
    return this.db.transaction(async (m) => {
      const prop = await m.findOne(Property, { where: { id: propertyId }, lock: { mode: 'pessimistic_write' } });
      if (!prop || prop.status !== 'funding') throw new BadRequestException('Esta propiedad no está en fondeo.');
      const existing = await m.findOne(Commitment, { where: { userId: user.id, propertyId, status: 'pending_approval' } });
      if (existing) throw new BadRequestException('Ya tienes una solicitud pendiente en esta propiedad.');
      const amount = units * Number(prop.unitPrice);
      const code = await this.nextCode(m, 'CMP', 'CMP');
      const row = await m.save(Commitment, m.create(Commitment, { code, userId: user.id, propertyId, units, amount, currency: prop.currency, status: 'pending_approval' }));
      await m.save(Notification, m.create(Notification, { userId: user.id, title: 'Solicitud enviada', body: `${prop.name} · ${units} unidad${units > 1 ? 'es' : ''} · ${money(amount, prop.currency, true)}` }));
      return { id: row.id, code, amount, units };
    });
  }

  async cancelCommitment(user: User, id: string) {
    const row = await this.db.getRepository(Commitment).findOneBy({ id, userId: user.id });
    if (!row || row.status !== 'pending_approval') throw new BadRequestException('Esa solicitud ya no se puede cancelar.');
    row.status = 'cancelled';
    await this.db.getRepository(Commitment).save(row);
    return { ok: true };
  }

  async walletView(user: User, currency = 'USD') {
    let w = await this.db.getRepository(Wallet).findOneBy({ userId: user.id, currency });
    if (!w) w = { available: 0, settled: 0, rentAccumulated: 0 } as Wallet;
    const commits = await this.db.getRepository(Commitment).find({ where: { userId: user.id, currency, status: 'active' } });
    const pending = await this.db.getRepository(Commitment).find({ where: { userId: user.id, currency, status: 'pending_approval' } });
    const withdrawingRows = await this.db.getRepository(Withdrawal).find({ where: { userId: user.id, currency, status: 'pending' } });
    const committed = commits.reduce((s, c) => s + Number(c.amount), 0);
    const pendingSum = pending.reduce((s, c) => s + Number(c.amount), 0);
    const withdrawing = withdrawingRows.reduce((s, c) => s + Number(c.amount), 0);
    const dep = await this.db.getRepository(Deposit).findOne({ where: { userId: user.id, currency, status: 'pending' }, order: { createdAt: 'DESC' } });
    return {
      currency,
      available: Number(w.available),
      committed,
      withdrawing,
      settled: Number(w.settled),
      pendingSum,
      total: Number(w.available) + committed + withdrawing,
      banks: BANKS[currency] || BANKS.USD,
      pendingDeposit: dep ? { id: dep.id, code: dep.code, amount: dep.amount, at: fmtWhen(dep.createdAt), operationNumber: dep.operationNumber, originBank: dep.originBank } : null,
    };
  }

  async movements(user: User, currency = 'USD') {
    const rows = await this.db.getRepository(Movement).find({ where: { userId: user.id, currency }, order: { createdAt: 'DESC' }, take: 40 });
    return rows.map((r) => ({ id: r.id, at: fmtDate(r.createdAt), concept: r.concept, reference: r.reference, amount: Number(r.amount) }));
  }

  async createDeposit(user: User, body: { amount: number; currency: string; operationNumber: string; originBank: string; originAccount: string; fileName?: string }) {
    if (user.investorStatus !== 'enabled') throw new ForbiddenException('Habilita tu cuenta antes de cargar saldo.');
    const amount = Number(body.amount);
    if (!amount || amount <= 0) throw new BadRequestException('Escribe el monto de la transferencia.');
    if (!body.operationNumber) throw new BadRequestException('Falta el número de operación.');
    const dup = await this.db.getRepository(Deposit).findOneBy({ operationNumber: body.operationNumber });
    const row = await this.db.transaction(async (m) => {
      const code = await this.nextCode(m, 'DEP', 'DEP');
      return m.save(Deposit, m.create(Deposit, {
        code, userId: user.id, amount, currency: body.currency || 'USD', operationNumber: body.operationNumber.trim(),
        originBank: body.originBank, originAccount: body.originAccount, fileName: body.fileName || 'constancia.pdf',
        status: 'pending', duplicate: !!dup,
      }));
    });
    await this.notify(user.id, 'Depósito en revisión', `${money(amount, row.currency, true)} · ${body.originBank || 'banco'} · ${fmtWhen(row.createdAt)}`);
    return { id: row.id, code: row.code, duplicate: row.duplicate };
  }

  async payoutAccounts(user: User) {
    const rows = await this.db.getRepository(PayoutAccount).find({ where: { userId: user.id }, order: { createdAt: 'ASC' } });
    return rows.map((a) => this.presentAccount(a));
  }

  private presentAccount(a: PayoutAccount) {
    const readyAt = new Date(a.createdAt).getTime() + 24 * 3600000;
    const ready = Date.now() >= readyAt;
    return {
      id: a.id, bank: a.bank, accountType: a.accountType, currency: a.currency, holder: a.holder,
      mask: mask(a.accountNumber), cci: a.cci, ready, readyAt: fmtWhen(new Date(readyAt)),
      label: `${a.bank} · ${a.accountType} ${a.currency === 'PEN' ? 'soles' : 'dólares'} ${mask(a.accountNumber)}`,
    };
  }

  async addPayout(user: User, body: { bank: string; accountType: string; currency: string; accountNumber: string; cci: string }) {
    if (!body.bank || !body.accountNumber || !body.cci) throw new BadRequestException('Completa banco, cuenta y CCI.');
    const row = await this.db.getRepository(PayoutAccount).save(this.db.getRepository(PayoutAccount).create({
      userId: user.id, bank: body.bank, accountType: body.accountType || 'Ahorros', currency: body.currency || 'USD',
      accountNumber: body.accountNumber, cci: body.cci, holder: this.name(user),
    }));
    return this.presentAccount(row);
  }

  async createWithdrawal(user: User, body: { amount: number; currency: string; payoutAccountId: string }) {
    const amount = Number(body.amount);
    const account = await this.db.getRepository(PayoutAccount).findOneBy({ id: body.payoutAccountId, userId: user.id });
    if (!account) throw new BadRequestException('Elige una cuenta de destino.');
    const ready = Date.now() >= new Date(account.createdAt).getTime() + 24 * 3600000;
    if (!ready) throw new BadRequestException('Esa cuenta se puede usar 24 horas después de agregarla.');
    const w = await this.db.getRepository(Wallet).findOneBy({ userId: user.id, currency: body.currency || account.currency });
    if (!w || Number(w.available) < amount) throw new BadRequestException('No tienes saldo disponible suficiente.');
    if (amount <= 0) throw new BadRequestException('Escribe un monto.');
    const confirmCode = code6();
    const row = await this.db.transaction(async (m) => {
      const code = await this.nextCode(m, 'RET', 'RET');
      return m.save(Withdrawal, m.create(Withdrawal, {
        code, userId: user.id, payoutAccountId: account.id, amount, currency: account.currency, status: 'pending_code', confirmCode,
      }));
    });
    return { id: row.id, code: row.code, devCode: confirmCode, account: this.presentAccount(account).label };
  }

  async confirmWithdrawal(user: User, id: string, code: string) {
    await this.db.transaction(async (m) => {
      const row = await m.findOne(Withdrawal, { where: { id, userId: user.id }, lock: { mode: 'pessimistic_write' } });
      if (!row || row.status !== 'pending_code') throw new BadRequestException('Ese retiro ya no está para confirmar.');
      if (row.confirmCode !== code) throw new BadRequestException('El código no es válido.');
      const w = await m.findOne(Wallet, { where: { userId: user.id, currency: row.currency }, lock: { mode: 'pessimistic_write' } });
      if (!w || Number(w.available) < Number(row.amount)) throw new BadRequestException('No tienes saldo disponible suficiente.');
      w.available = Number(w.available) - Number(row.amount);
      row.status = 'pending';
      row.confirmCode = null;
      const account = await m.findOne(PayoutAccount, { where: { id: row.payoutAccountId } });
      await m.save(Wallet, w);
      await m.save(Withdrawal, row);
      await m.save(Movement, m.create(Movement, {
        userId: user.id, currency: row.currency, amount: -Number(row.amount),
        concept: 'Retiro solicitado', reference: `${row.code} · ${account ? account.bank : ''} ${account ? mask(account.accountNumber) : ''}`,
      }));
    });
    return { ok: true };
  }

  async portfolio(user: User) {
    const rows = await this.db.getRepository(Commitment).find({
      where: { userId: user.id, status: In(['active', 'owned', 'pending_approval']) },
      order: { createdAt: 'ASC' },
    });
    const props = await this.db.getRepository(Property).find();
    const byId = new Map(props.map((p) => [p.id, p]));
    const positions = rows.map((c) => {
      const p = byId.get(c.propertyId);
      const statusKey = c.status === 'pending_approval' ? 'pending_approval' : p.status;
      const [statusLabel, statusClass] = c.status === 'pending_approval' ? COMMIT.pending_approval : (STATUS[p.status] || ['', 'b-gray']);
      const share = p.unitsTotal ? c.units / p.unitsTotal : 0;
      const monthly = ['operating', 'sale_vote', 'selling'].includes(p.status) ? Math.round((Number(p.monthlyRent) - Number(p.monthlyExpenses)) * share * 100) / 100 : 0;
      return {
        id: c.id, propertyId: p.id, name: p.name, city: p.city, gradient: p.gradient, icon: p.icon,
        units: c.units, amount: Number(c.amount), valuation: Number(c.valuation) || null,
        yieldPct: Number(p.yieldPct), monthly, status: statusKey, statusLabel, statusClass,
        commitmentStatus: c.status, closeLabel: p.closeDate ? fmtDate(p.closeDate) : '',
        canSell: c.status === 'owned' && p.status === 'operating',
        currency: c.currency,
      };
    });
    const invested = positions.filter((p) => p.commitmentStatus !== 'pending_approval').reduce((s, p) => s + p.amount, 0);
    const valuation = positions.reduce((s, p) => s + (p.valuation || (p.commitmentStatus === 'pending_approval' ? 0 : p.amount)), 0);
    const rent = positions.reduce((s, p) => s + (p.commitmentStatus === 'owned' ? 0 : 0), 0);
    const w = await this.db.getRepository(Wallet).findOneBy({ userId: user.id, currency: 'USD' });
    const next = positions.find((p) => p.monthly > 0);
    const bars = [498, 525, 525, 525, 525, 525, 498, 525, 525, 525, 525, next?.monthly || 525];
    return {
      invested,
      countProps: new Set(positions.filter((p) => p.commitmentStatus !== 'pending_approval').map((p) => p.propertyId)).size,
      countUnits: positions.filter((p) => p.commitmentStatus !== 'pending_approval').reduce((s, p) => s + p.units, 0),
      valuation,
      rentAccumulated: Number(w?.rentAccumulated || 0),
      next: next ? { amount: next.monthly, name: next.name, when: '1 nov 2026' } : null,
      positions,
      bars,
      vote: props.filter((p) => p.status === 'sale_vote').map((p) => ({
        id: p.id, name: p.name, salePrice: p.salePrice, voteYes: p.voteYes, unitsTotal: p.unitsTotal, voteEnds: p.voteEnds ? fmtDate(p.voteEnds) : '',
      })),
    };
  }

  async vote(user: User, propertyId: string, choice: 'yes' | 'no') {
    const prop = await this.db.getRepository(Property).findOneBy({ id: propertyId });
    if (!prop || prop.status !== 'sale_vote') throw new BadRequestException('No hay una votación abierta.');
    const owns = await this.db.getRepository(Commitment).findOneBy({ userId: user.id, propertyId, status: 'owned' });
    if (!owns) throw new ForbiddenException('Solo votan los copropietarios.');
    let row = await this.db.getRepository(Vote).findOneBy({ userId: user.id, propertyId });
    const prev = row?.choice;
    if (!row) row = this.db.getRepository(Vote).create({ userId: user.id, propertyId, choice });
    row.choice = choice;
    await this.db.getRepository(Vote).save(row);
    if (prev !== 'yes' && choice === 'yes') prop.voteYes += owns.units;
    if (prev === 'yes' && choice === 'no') prop.voteYes = Math.max(0, prop.voteYes - owns.units);
    await this.db.getRepository(Property).save(prop);
    return { ok: true, voteYes: prop.voteYes };
  }

  async secondary(user: User) {
    const offers = await this.db.getRepository(Offer).find({ order: { createdAt: 'DESC' } });
    const props = await this.db.getRepository(Property).find();
    const byId = new Map(props.map((p) => [p.id, p]));
    const people = await this.users().find();
    const names = new Map(people.map((u) => [u.id, this.name(u)]));
    const commission = Number(await this.setting('commission_pct', '3')) / 100;
    const list = offers.map((o) => {
      const p = byId.get(o.propertyId);
      const [statusLabel, statusClass] = o.sellerId === user.id ? ['Tu oferta', 'b-blue'] : (OFFER[o.status] || ['', 'b-gray']);
      const delta = o.referencePrice ? (Number(o.price) - Number(o.referencePrice)) / Number(o.referencePrice) : 0;
      return {
        id: o.id, code: o.code, propertyId: o.propertyId, name: p?.name, city: p?.city, gradient: p?.gradient, icon: p?.icon,
        units: o.units, price: Number(o.price), referencePrice: Number(o.referencePrice), delta,
        status: o.status, statusLabel, statusClass, mine: o.sellerId === user.id,
        seller: names.get(o.sellerId), buyer: o.buyerId ? names.get(o.buyerId) : null,
        currency: o.currency, net: Math.round(Number(o.price) * (1 - commission) * 100) / 100,
        commission: Math.round(Number(o.price) * commission * 100) / 100,
        windowEnds: o.windowEnds ? fmtDate(o.windowEnds) : null,
        retractoEnds: o.retractoEnds ? fmtDate(o.retractoEnds) : null,
        createdAt: fmtDate(o.createdAt),
      };
    });
    return { offers: list, commissionPct: commission * 100 };
  }

  async createOffer(user: User, body: { propertyId: string; units: number; price: number }) {
    const units = Math.floor(Number(body.units));
    const price = Number(body.price);
    if (units < 1 || price <= 0) throw new BadRequestException('Indica unidades y precio.');
    const prop = await this.db.getRepository(Property).findOneBy({ id: body.propertyId });
    if (!prop || prop.status !== 'operating') throw new BadRequestException('Solo puedes vender una cuota inscrita y sin votación en curso.');
    const owned = await this.db.getRepository(Commitment).findOneBy({ userId: user.id, propertyId: prop.id, status: 'owned' });
    if (!owned || owned.units < units) throw new BadRequestException('No tienes esas unidades.');
    const listed = await this.db.getRepository(Offer).find({ where: { sellerId: user.id, propertyId: prop.id, status: In(['internal_window', 'open', 'buyer_found', 'retracto', 'notary']) } });
    const listedUnits = listed.reduce((s, o) => s + o.units, 0);
    if (owned.units - listedUnits < units) throw new BadRequestException('Esas unidades ya están en una oferta.');
    const days = Number(await this.setting('secondary_window_days', '7'));
    const row = await this.db.transaction(async (m) => {
      const code = await this.nextCode(m, 'OFR', 'OFR');
      return m.save(Offer, m.create(Offer, {
        code, propertyId: prop.id, sellerId: user.id, units, price, referencePrice: Number(prop.unitPrice) * units,
        currency: prop.currency, status: 'internal_window', windowEnds: new Date(Date.now() + days * 86400000),
      }));
    });
    return { id: row.id, code: row.code };
  }

  async buyOffer(user: User, id: string) {
    if (user.investorStatus !== 'enabled') throw new ForbiddenException('Tu cuenta todavía no está habilitada para invertir.');
    await this.db.transaction(async (m) => {
      const offer = await m.findOne(Offer, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!offer || !['open', 'internal_window'].includes(offer.status)) throw new BadRequestException('Esa oferta ya no está disponible.');
      if (offer.sellerId === user.id) throw new BadRequestException('No puedes comprar tu propia oferta.');
      if (offer.status === 'internal_window') {
        const owns = await m.findOne(Commitment, { where: { userId: user.id, propertyId: offer.propertyId, status: 'owned' } });
        if (!owns) throw new ForbiddenException('Durante la ventana interna solo compran los copropietarios.');
      }
      const w = await m.findOne(Wallet, { where: { userId: user.id, currency: offer.currency }, lock: { mode: 'pessimistic_write' } });
      if (!w || Number(w.available) < Number(offer.price)) throw new BadRequestException('No tienes saldo disponible suficiente.');
      w.available = Number(w.available) - Number(offer.price);
      offer.buyerId = user.id;
      offer.status = 'buyer_found';
      offer.reserved = true;
      await m.save(Wallet, w);
      await m.save(Offer, offer);
      await m.save(Movement, m.create(Movement, { userId: user.id, currency: offer.currency, amount: -Number(offer.price), concept: 'Reserva · mercado secundario', reference: offer.code }));
    });
    return { ok: true };
  }

  async retracto(user: User, id: string) {
    await this.db.transaction(async (m) => {
      const offer = await m.findOne(Offer, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!offer || offer.status !== 'retracto') throw new BadRequestException('El retracto no está abierto.');
      const owns = await m.findOne(Commitment, { where: { userId: user.id, propertyId: offer.propertyId, status: 'owned' } });
      if (!owns || offer.sellerId === user.id) throw new ForbiddenException('El retracto es para los otros copropietarios.');
      const existing = await m.findOne(Retracto, { where: { offerId: id } });
      if (existing) throw new BadRequestException('Otro copropietario ya ejerció el retracto.');
      const w = await m.findOne(Wallet, { where: { userId: user.id, currency: offer.currency }, lock: { mode: 'pessimistic_write' } });
      if (!w || Number(w.available) < Number(offer.price)) throw new BadRequestException('No tienes saldo disponible suficiente.');
      if (offer.reserved && offer.buyerId) {
        const prev = await m.findOne(Wallet, { where: { userId: offer.buyerId, currency: offer.currency }, lock: { mode: 'pessimistic_write' } });
        if (prev) {
          prev.available = Number(prev.available) + Number(offer.price);
          await m.save(Wallet, prev);
          await m.save(Movement, m.create(Movement, { userId: offer.buyerId, currency: offer.currency, amount: Number(offer.price), concept: 'Devolución · retracto', reference: offer.code }));
        }
      }
      w.available = Number(w.available) - Number(offer.price);
      offer.buyerId = user.id;
      offer.reserved = true;
      await m.save(Wallet, w);
      await m.save(Offer, offer);
      await m.save(Retracto, m.create(Retracto, { offerId: id, userId: user.id }));
      await m.save(Movement, m.create(Movement, { userId: user.id, currency: offer.currency, amount: -Number(offer.price), concept: 'Retracto · mercado secundario', reference: offer.code }));
    });
    return { ok: true };
  }

  async cancelOffer(user: User, id: string) {
    await this.db.transaction(async (m) => {
      const offer = await m.findOne(Offer, { where: { id, sellerId: user.id }, lock: { mode: 'pessimistic_write' } });
      if (!offer || ['completed', 'cancelled'].includes(offer.status)) throw new BadRequestException('Esa oferta ya no se puede cancelar.');
      if (offer.status === 'notary') throw new BadRequestException('La oferta ya está en notaría.');
      await this.releaseOffer(m, offer);
      offer.status = 'cancelled';
      await m.save(Offer, offer);
    });
    return { ok: true };
  }

  private async releaseOffer(m: EntityManager, offer: Offer) {
    if (offer.reserved && offer.buyerId) {
      const w = await m.findOne(Wallet, { where: { userId: offer.buyerId, currency: offer.currency }, lock: { mode: 'pessimistic_write' } });
      if (w) {
        w.available = Number(w.available) + Number(offer.price);
        await m.save(Wallet, w);
        await m.save(Movement, m.create(Movement, { userId: offer.buyerId, currency: offer.currency, amount: Number(offer.price), concept: 'Devolución · oferta cancelada', reference: offer.code }));
      }
      offer.reserved = false;
    }
  }

  async notifications(user: User) {
    const rows = await this.db.getRepository(Notification).find({ where: { userId: user.id }, order: { createdAt: 'DESC' }, take: 20 });
    return rows.map((n) => ({ id: n.id, title: n.title, body: n.body, read: n.read, at: fmtWhen(n.createdAt) }));
  }

  async readNotifications(user: User) {
    await this.db.getRepository(Notification).update({ userId: user.id, read: false }, { read: true });
    return { ok: true };
  }

  async changePassword(user: User, password: string) {
    if (!strongPassword(password)) throw new BadRequestException('La contraseña necesita 12 caracteres, una mayúscula, un número y un símbolo.');
    user.passwordHash = await hashPassword(password);
    await this.users().save(user);
    return { ok: true };
  }

  async createComplaint(body: { name: string; email: string; document?: string; phone?: string; address?: string; kind?: string; service?: string; amount?: string; detail: string; request?: string }) {
    if (!body.name || !body.email || !body.detail) throw new BadRequestException('Faltan tu nombre, tu correo o el detalle.');
    const row = await this.db.transaction(async (m) => {
      const year = new Date().getFullYear();
      const code = `R-${year}-${String((await this.nextCode(m, 'R', 'X')).split('-').pop()).padStart(6, '0')}`;
      return m.save(Complaint, m.create(Complaint, { ...body, code, kind: body.kind || 'reclamo', status: 'open' }));
    });
    return { code: row.code };
  }

  private async notify(userId: string, title: string, body: string) {
    await this.db.getRepository(Notification).save({ userId, title, body, read: false });
  }

  private async person(id: string) {
    const u = await this.users().findOneBy({ id });
    if (!u) return null;
    return u;
  }

  async adminDeposits(status = 'pending') {
    const rows = await this.db.getRepository(Deposit).find({ where: status === 'all' ? {} : { status }, order: { createdAt: 'DESC' } });
    const out = [];
    for (const d of rows) {
      const u = await this.person(d.userId);
      out.push({
        ...d, amount: Number(d.amount), investor: u ? this.name(u) : '', document: u ? `${u.documentType || ''} ${u.documentNumber || ''}`.trim() : '',
        at: fmtWhen(d.createdAt), money: money(d.amount, d.currency, true),
      });
    }
    const pending = out.filter((d) => d.status === 'pending');
    const pendingUsd = pending.filter((d) => d.currency === 'USD').reduce((s, d) => s + d.amount, 0);
    const pendingPen = pending.filter((d) => d.currency === 'PEN').reduce((s, d) => s + d.amount, 0);
    return { rows: status === 'pending' ? pending : out, pending: pending.length, pendingUsd, pendingPen };
  }

  async decideDeposit(actor: User, id: string, approve: boolean, reason?: string) {
    this.staff(actor, ['tesoreria']);
    await this.db.transaction(async (m) => {
      const d = await m.findOne(Deposit, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!d || d.status !== 'pending') throw new BadRequestException('Ese depósito ya fue resuelto.');
      d.decidedAt = new Date();
      if (!approve) {
        d.status = 'rejected';
        d.rejectReason = reason || 'No coincide con el extracto.';
        await m.save(Deposit, d);
        await m.save(Notification, m.create(Notification, { userId: d.userId, title: 'Depósito rechazado', body: `${d.code} · ${d.rejectReason}` }));
        return;
      }
      d.status = 'approved';
      let w = await m.findOne(Wallet, { where: { userId: d.userId, currency: d.currency }, lock: { mode: 'pessimistic_write' } });
      if (!w) w = await m.save(Wallet, m.create(Wallet, { userId: d.userId, currency: d.currency, available: 0, settled: 0, rentAccumulated: 0 }));
      w.available = Number(w.available) + Number(d.amount);
      await m.save(Wallet, w);
      await m.save(Deposit, d);
      await m.save(Movement, m.create(Movement, { userId: d.userId, currency: d.currency, amount: Number(d.amount), concept: 'Depósito validado', reference: `${d.code} · ${d.originBank || ''}` }));
      await m.save(Notification, m.create(Notification, { userId: d.userId, title: 'Depósito acreditado', body: `${money(d.amount, d.currency, true)} ya está disponible.` }));
    });
    return { ok: true };
  }

  async adminWithdrawals(status = 'pending') {
    const rows = await this.db.getRepository(Withdrawal).find({ where: status === 'all' ? {} : { status }, order: { createdAt: 'DESC' } });
    const out = [];
    for (const d of rows) {
      const u = await this.person(d.userId);
      const a = await this.db.getRepository(PayoutAccount).findOneBy({ id: d.payoutAccountId });
      out.push({
        id: d.id, code: d.code, amount: Number(d.amount), currency: d.currency, status: d.status,
        investor: u ? this.name(u) : '', at: fmtWhen(d.createdAt), money: money(d.amount, d.currency, true),
        account: a ? `${a.bank} ${mask(a.accountNumber)}` : '',
      });
    }
    return { rows: out };
  }

  async decideWithdrawal(actor: User, id: string, action: 'approve' | 'reject' | 'pay', reason?: string) {
    this.staff(actor, ['tesoreria']);
    await this.db.transaction(async (m) => {
      const d = await m.findOne(Withdrawal, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!d) throw new NotFoundException('No encontramos ese retiro.');
      if (action === 'pay') {
        if (d.status !== 'approved') throw new BadRequestException('Primero aprueba el retiro.');
        d.status = 'paid';
        d.decidedAt = new Date();
        await m.save(Withdrawal, d);
        await m.save(Notification, m.create(Notification, { userId: d.userId, title: 'Retiro pagado', body: `${d.code} · ${money(d.amount, d.currency, true)}` }));
        return;
      }
      if (d.status !== 'pending') throw new BadRequestException('Ese retiro ya fue resuelto.');
      if (action === 'reject') {
        d.status = 'rejected';
        d.rejectReason = reason || 'No se pudo pagar.';
        const w = await m.findOne(Wallet, { where: { userId: d.userId, currency: d.currency }, lock: { mode: 'pessimistic_write' } });
        if (w) {
          w.available = Number(w.available) + Number(d.amount);
          await m.save(Wallet, w);
        }
        await m.save(Withdrawal, d);
        await m.save(Movement, m.create(Movement, { userId: d.userId, currency: d.currency, amount: Number(d.amount), concept: 'Retiro rechazado', reference: d.code }));
        return;
      }
      d.status = 'approved';
      d.decidedAt = new Date();
      await m.save(Withdrawal, d);
    });
    return { ok: true };
  }

  async adminCommitments() {
    const rows = await this.db.getRepository(Commitment).find({ where: { status: 'pending_approval' }, order: { createdAt: 'ASC' } });
    const out = [];
    for (const c of rows) {
      const u = await this.person(c.userId);
      const p = await this.db.getRepository(Property).findOneBy({ id: c.propertyId });
      out.push({ id: c.id, code: c.code, investor: u ? this.name(u) : '', property: p?.name, units: c.units, amount: Number(c.amount), currency: c.currency, money: money(c.amount, c.currency, true), age: ageLabel(c.createdAt) });
    }
    return out;
  }

  async decideCommitment(actor: User, id: string, approve: boolean, reason?: string) {
    this.staff(actor, ['admin']);
    await this.db.transaction(async (m) => {
      const c = await m.findOne(Commitment, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!c || c.status !== 'pending_approval') throw new BadRequestException('Esa solicitud ya fue resuelta.');
      const prop = await m.findOne(Property, { where: { id: c.propertyId }, lock: { mode: 'pessimistic_write' } });
      const reject = async (why: string) => {
        c.status = 'rejected';
        c.rejectReason = why;
        c.decidedAt = new Date();
        await m.save(Commitment, c);
        await m.save(Notification, m.create(Notification, { userId: c.userId, title: 'Solicitud rechazada', body: `${c.code} · ${why}` }));
      };
      if (!approve) return reject(reason || 'Rechazada por un administrador.');
      if (!prop || prop.status !== 'funding') return reject('La propiedad ya no está en fondeo.');
      const taken = await m.find(Commitment, { where: { propertyId: prop.id, status: In(['active', 'owned']) } });
      const used = taken.reduce((s, row) => s + row.units, 0);
      if (used + c.units > prop.unitsTotal) return reject('Ya no quedan esas unidades.');
      let w = await m.findOne(Wallet, { where: { userId: c.userId, currency: c.currency }, lock: { mode: 'pessimistic_write' } });
      if (!w || Number(w.available) < Number(c.amount)) return reject('Saldo insuficiente al momento de aprobar.');
      w.available = Number(w.available) - Number(c.amount);
      c.status = 'active';
      c.decidedAt = new Date();
      await m.save(Wallet, w);
      await m.save(Commitment, c);
      await m.save(Movement, m.create(Movement, { userId: c.userId, currency: c.currency, amount: -Number(c.amount), concept: `Compromiso · ${prop.name}`, reference: `${c.code} · ${c.units} unidad${c.units > 1 ? 'es' : ''}` }));
      await m.save(Notification, m.create(Notification, { userId: c.userId, title: 'Compromiso aprobado', body: `${prop.name} · ${money(c.amount, c.currency)} quedaron comprometidos.` }));
    });
    return { ok: true };
  }

  async saveProperty(actor: User, body: Partial<Property>, id?: string) {
    this.staff(actor, ['operaciones']);
    const repo = this.db.getRepository(Property);
    let row = id ? await repo.findOneBy({ id }) : repo.create({ status: 'draft', gradient: 'g1', icon: 'building', unitsTotal: 20 });
    if (!row) throw new NotFoundException('No encontramos esa propiedad.');
    const prev = row.status;
    const fields = ['name', 'city', 'kind', 'currency', 'price', 'unitPrice', 'unitsTotal', 'yieldPct', 'status', 'closeDate', 'monthlyRent', 'monthlyExpenses', 'notary', 'occupancy', 'contractUntil', 'gradient', 'icon', 'note', 'salePrice', 'voteEnds'] as const;
    for (const f of fields) if (body[f] !== undefined && body[f] !== '') (row as any)[f] = body[f];
    if (!row.name || !row.city) throw new BadRequestException('Nombre y ciudad son obligatorios.');
    if (!row.unitPrice && row.price && row.unitsTotal) row.unitPrice = Number(row.price) / Number(row.unitsTotal);
    row = await repo.save(row);
    if (body.status && body.status !== prev) await this.onStatus(row, prev);
    return this.presentProperty(row);
  }

  private async onStatus(prop: Property, prev: string) {
    if (prop.status !== 'funding' && prev === 'funding') {
      const pending = await this.db.getRepository(Commitment).find({ where: { propertyId: prop.id, status: 'pending_approval' } });
      for (const c of pending) {
        c.status = 'rejected';
        c.rejectReason = 'La propiedad salió de fondeo.';
        await this.db.getRepository(Commitment).save(c);
        await this.notify(c.userId, 'Solicitud rechazada', `${prop.name} ya no está en fondeo.`);
      }
    }
    if (['registered', 'operating'].includes(prop.status)) {
      await this.db.getRepository(Commitment).update({ propertyId: prop.id, status: 'active' }, { status: 'owned' });
    }
    if (prop.status === 'cancelled') {
      const actives = await this.db.getRepository(Commitment).find({ where: { propertyId: prop.id, status: 'active' } });
      for (const c of actives) {
        let w = await this.db.getRepository(Wallet).findOneBy({ userId: c.userId, currency: c.currency });
        if (!w) w = await this.db.getRepository(Wallet).save({ userId: c.userId, currency: c.currency, available: 0, settled: 0, rentAccumulated: 0 });
        w.available = Number(w.available) + Number(c.amount);
        await this.db.getRepository(Wallet).save(w);
        c.status = 'cancelled';
        await this.db.getRepository(Commitment).save(c);
        await this.db.getRepository(Movement).save({ userId: c.userId, currency: c.currency, amount: Number(c.amount), concept: `Devolución · ${prop.name}`, reference: c.code });
      }
    }
  }

  async distributeRent(actor: User, body: { propertyId: string; period: string; gross: number; expenses: number }) {
    this.staff(actor, ['operaciones']);
    const prop = await this.db.getRepository(Property).findOneBy({ id: body.propertyId });
    if (!prop) throw new NotFoundException('No encontramos esa propiedad.');
    const gross = Number(body.gross);
    const expenses = Number(body.expenses);
    const net = Math.round((gross - expenses) * 100) / 100;
    if (net < 0) throw new BadRequestException('Los gastos no pueden superar la renta.');
    const owners = await this.db.getRepository(Commitment).find({ where: { propertyId: prop.id, status: 'owned' } });
    const units = owners.reduce((s, o) => s + o.units, 0) || prop.unitsTotal;
    await this.db.transaction(async (m) => {
      await m.save(RentRun, m.create(RentRun, { propertyId: prop.id, period: body.period, gross, expenses, net, status: 'paid' }));
      for (const o of owners) {
        const share = Math.round(net * (o.units / units) * 100) / 100;
        let w = await m.findOne(Wallet, { where: { userId: o.userId, currency: prop.currency }, lock: { mode: 'pessimistic_write' } });
        if (!w) w = await m.save(Wallet, m.create(Wallet, { userId: o.userId, currency: prop.currency, available: 0, settled: 0, rentAccumulated: 0 }));
        w.available = Number(w.available) + share;
        w.rentAccumulated = Number(w.rentAccumulated) + share;
        o.rentAccumulated = Number(o.rentAccumulated) + share;
        await m.save(Wallet, w);
        await m.save(Commitment, o);
        await m.save(Movement, m.create(Movement, { userId: o.userId, currency: prop.currency, amount: share, concept: `Renta · ${prop.name}`, reference: `REN-${body.period}` }));
        await m.save(Notification, m.create(Notification, { userId: o.userId, title: 'Renta acreditada', body: `${prop.name} · ${money(share, prop.currency, true)}` }));
      }
    });
    return { ok: true, net };
  }

  async rentRuns() {
    const rows = await this.db.getRepository(RentRun).find({ order: { createdAt: 'DESC' }, take: 20 });
    const props = await this.db.getRepository(Property).find();
    const names = new Map(props.map((p) => [p.id, p.name]));
    return rows.map((r) => ({ ...r, gross: Number(r.gross), expenses: Number(r.expenses), net: Number(r.net), property: names.get(r.propertyId) }));
  }

  async advanceOffer(actor: User, id: string) {
    this.staff(actor, ['operaciones']);
    const next: Record<string, string> = { buyer_found: 'retracto', retracto: 'notary', notary: 'completed', internal_window: 'open' };
    await this.db.transaction(async (m) => {
      const offer = await m.findOne(Offer, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!offer || !next[offer.status]) throw new BadRequestException('Esa oferta no tiene un paso siguiente.');
      const step = next[offer.status];
      if (step === 'retracto') {
        const days = Number(await this.setting('retracto_days', '30'));
        offer.retractoEnds = new Date(Date.now() + days * 86400000);
      }
      if (step === 'completed') await this.completeOffer(m, offer);
      offer.status = step;
      await m.save(Offer, offer);
    });
    return { ok: true };
  }

  private async completeOffer(m: EntityManager, offer: Offer) {
    if (!offer.buyerId) throw new BadRequestException('No hay comprador.');
    const commission = Number(await this.setting('commission_pct', '3')) / 100;
    const net = Math.round(Number(offer.price) * (1 - commission) * 100) / 100;
    if (!offer.reserved) {
      const buyerW = await m.findOne(Wallet, { where: { userId: offer.buyerId, currency: offer.currency }, lock: { mode: 'pessimistic_write' } });
      if (!buyerW || Number(buyerW.available) < Number(offer.price)) throw new BadRequestException('El comprador ya no tiene el saldo.');
      buyerW.available = Number(buyerW.available) - Number(offer.price);
      await m.save(Wallet, buyerW);
    }
    let sellerW = await m.findOne(Wallet, { where: { userId: offer.sellerId, currency: offer.currency }, lock: { mode: 'pessimistic_write' } });
    if (!sellerW) sellerW = await m.save(Wallet, m.create(Wallet, { userId: offer.sellerId, currency: offer.currency, available: 0, settled: 0, rentAccumulated: 0 }));
    sellerW.settled = Number(sellerW.settled) + net;
    sellerW.available = Number(sellerW.available) + net;
    await m.save(Wallet, sellerW);
    await m.save(Movement, m.create(Movement, { userId: offer.sellerId, currency: offer.currency, amount: net, concept: 'Venta en secundario', reference: offer.code }));
    const sellerPos = await m.findOne(Commitment, { where: { userId: offer.sellerId, propertyId: offer.propertyId, status: 'owned' }, lock: { mode: 'pessimistic_write' } });
    if (!sellerPos || sellerPos.units < offer.units) throw new BadRequestException('El vendedor ya no tiene esas unidades.');
    const unitAmount = Number(sellerPos.amount) / sellerPos.units;
    sellerPos.units -= offer.units;
    sellerPos.amount = Number(sellerPos.amount) - unitAmount * offer.units;
    if (sellerPos.units <= 0) sellerPos.status = 'cancelled';
    await m.save(Commitment, sellerPos);
    let buyerPos = await m.findOne(Commitment, { where: { userId: offer.buyerId, propertyId: offer.propertyId, status: 'owned' } });
    if (!buyerPos) {
      const code = await this.nextCode(m, 'CMP', 'CMP');
      buyerPos = m.create(Commitment, { code, userId: offer.buyerId, propertyId: offer.propertyId, units: 0, amount: 0, currency: offer.currency, status: 'owned' });
    }
    buyerPos.units += offer.units;
    buyerPos.amount = Number(buyerPos.amount) + Number(offer.price);
    await m.save(Commitment, buyerPos);
  }

  riskOf(u: User) {
    if (u.pep || u.fundsOrigin === 'otro' || ['CE', 'Pasaporte'].includes(u.documentType)) return ['Alto', 'b-red'];
    if (['herencia', 'negocio'].includes(u.fundsOrigin)) return ['Medio', 'b-amber'];
    return ['Bajo', 'b-teal'];
  }

  async plaftQueue(status = 'review') {
    const where = status === 'resolved' ? { investorStatus: In(['enabled', 'rejected']) } : { investorStatus: status === 'observed' ? 'observed' : In(['review', 'observed']) };
    const rows = await this.users().find({ where: { role: 'investor', ...where }, order: { createdAt: 'ASC' } });
    return rows.map((u) => {
      const [risk, riskClass] = this.riskOf(u);
      return { ...this.presentUser(u), listOnu: u.listOnu, listOfac: u.listOfac, risk, riskClass, age: ageLabel(u.createdAt), fundsLabel: u.fundsDetail ? `${u.fundsOrigin} · ${u.fundsDetail}` : u.fundsOrigin };
    });
  }

  async decidePlaft(actor: User, id: string, action: 'approve' | 'reject' | 'observe', note?: string) {
    this.staff(actor, ['cumplimiento']);
    const u = await this.users().findOneBy({ id });
    if (!u) throw new NotFoundException('No encontramos a esa persona.');
    if (action === 'approve') {
      u.investorStatus = 'enabled';
      u.plaftDecidedAt = new Date();
      u.plaftNote = note || 'Aprobado.';
      await this.notify(u.id, 'Cuenta habilitada', 'Ya puedes cargar saldo y solicitar unidades.');
    } else if (action === 'reject') {
      u.investorStatus = 'rejected';
      u.plaftNote = note || 'No pudimos habilitarte.';
      await this.notify(u.id, 'Evaluación rechazada', u.plaftNote);
    } else {
      u.investorStatus = 'observed';
      u.plaftAsk = note || 'Sube un sustento para continuar.';
      await this.notify(u.id, 'Necesitamos un documento', u.plaftAsk);
    }
    await this.users().save(u);
    return this.presentUser(u);
  }

  async alerts() {
    const rows = await this.db.getRepository(Alert).find({ order: { createdAt: 'DESC' } });
    return rows.map((a) => ({ ...a, age: ageLabel(a.createdAt) }));
  }

  async ackAlert(actor: User, id: string) {
    this.staff(actor, ['cumplimiento']);
    await this.db.getRepository(Alert).update({ id }, { status: 'closed' });
    return { ok: true };
  }

  async complaints() {
    const rows = await this.db.getRepository(Complaint).find({ order: { createdAt: 'DESC' } });
    return rows.map((c) => ({ ...c, at: fmtDate(c.createdAt) }));
  }

  async respondComplaint(actor: User, id: string, response: string) {
    this.staff(actor, ['admin']);
    const row = await this.db.getRepository(Complaint).findOneBy({ id });
    if (!row) throw new NotFoundException('No encontramos esa hoja.');
    row.response = response;
    row.status = 'answered';
    await this.db.getRepository(Complaint).save(row);
    return { ok: true };
  }

  async team() {
    const rows = await this.users().find({ where: { role: In(['tesoreria', 'operaciones', 'cumplimiento', 'admin']) }, order: { createdAt: 'ASC' } });
    return rows.map((u) => this.presentUser(u));
  }

  async invite(actor: User, body: { email: string; firstName: string; lastName: string; role: string; password?: string }) {
    this.staff(actor, ['admin']);
    if (!['tesoreria', 'operaciones', 'cumplimiento', 'admin'].includes(body.role)) throw new BadRequestException('Elige un rol del equipo.');
    const email = (body.email || '').trim().toLowerCase();
    if (await this.users().findOneBy({ email })) throw new BadRequestException('Ese correo ya existe.');
    const password = body.password && strongPassword(body.password) ? body.password : `Propia.${code6()}!`;
    await this.users().save(this.users().create({
      email, passwordHash: await hashPassword(password), firstName: body.firstName, lastName: body.lastName,
      role: body.role, emailConfirmed: true, investorStatus: 'enabled', userStatus: 'active',
    }));
    return { email, password };
  }

  async investors() {
    const rows = await this.users().find({ where: { role: 'investor' }, order: { createdAt: 'DESC' } });
    return rows.map((u) => this.presentUser(u));
  }

  async settings() {
    const rows = await this.db.getRepository(Setting).find();
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  async saveSettings(actor: User, body: Record<string, string>) {
    this.staff(actor, ['cumplimiento']);
    const keys = ['secondary_window_days', 'retracto_days', 'commission_pct', 'closing_cost_usd', 'closing_cost_pen', 'double_approval_usd'];
    for (const [key, value] of Object.entries(body)) {
      if (!keys.includes(key)) continue;
      if (actor.role === 'cumplimiento' && key !== 'commission_pct') continue;
      let row = await this.db.getRepository(Setting).findOneBy({ key });
      if (!row) row = this.db.getRepository(Setting).create({ key, value: String(value ?? '') });
      row.value = String(value ?? '');
      await this.db.getRepository(Setting).save(row);
    }
    return this.settings();
  }

  async tasks() {
    const commits = await this.adminCommitments();
    const complaints = (await this.complaints()).filter((c) => c.status === 'open');
    const plaft = await this.plaftQueue('review');
    const items = [
      ...commits.map((c) => ({ id: c.id, kind: 'commitment', title: 'Aprobar compromiso', detail: `${c.investor} · ${c.property} · ${c.money}`, origin: 'Inversionista', age: c.age })),
      ...plaft.map((p) => ({ id: p.id, kind: 'plaft', title: 'Evaluación PLAFT', detail: `${p.name} · riesgo ${p.risk.toLowerCase()}`, origin: 'Cumplimiento', age: p.age })),
      ...complaints.map((c) => ({ id: c.id, kind: 'complaint', title: `Reclamación ${c.code}`, detail: c.detail, origin: 'Libro', age: ageLabel(c.createdAt) })),
    ];
    return items;
  }

  async signInfo(token: string) {
    const user = await this.users().findOne({ where: [{ signToken: token }, { spouseToken: token }] });
    if (!user) throw new NotFoundException('No encontramos ese documento.');
    const who = user.spouseToken === token ? 'spouse' : 'holder';
    return { who, name: who === 'spouse' ? user.spouseName : this.name(user), envelopeId: user.envelopeId, done: who === 'spouse' ? user.spouseSigned : user.holderSigned };
  }
}
