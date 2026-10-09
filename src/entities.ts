import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

const num = {
  type: 'numeric' as const,
  precision: 14,
  scale: 2,
  default: 0,
  transformer: { to: (v: number) => v, from: (v: string) => (v == null ? 0 : Number(v)) },
};

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() email: string;
  @Column() passwordHash: string;
  @Column({ default: 'investor' }) role: string;
  @Column({ default: 'active' }) userStatus: string;
  @Column({ default: 'onboarding' }) investorStatus: string;
  @Column({ default: false }) emailConfirmed: boolean;
  @Column({ nullable: true }) confirmCode: string;
  @Column({ nullable: true }) resetCode: string;
  @Column({ nullable: true }) firstName: string;
  @Column({ nullable: true }) lastName: string;
  @Column({ nullable: true }) phone: string;
  @Column({ nullable: true }) documentType: string;
  @Column({ nullable: true }) documentNumber: string;
  @Column({ type: 'date', nullable: true }) birthDate: string;
  @Column({ nullable: true }) address: string;
  @Column({ nullable: true }) district: string;
  @Column({ nullable: true }) nationality: string;
  @Column({ default: true }) isDomiciled: boolean;
  @Column({ nullable: true }) maritalStatus: string;
  @Column({ nullable: true }) propertyRegime: string;
  @Column({ nullable: true }) spouseName: string;
  @Column({ nullable: true }) spouseEmail: string;
  @Column({ nullable: true }) fundsOrigin: string;
  @Column({ nullable: true }) fundsDetail: string;
  @Column({ default: false }) pep: boolean;
  @Column({ nullable: true }) pepDetail: string;
  @Column({ default: true }) beneficialOwner: boolean;
  @Column({ default: false }) fundsDeclared: boolean;
  @Column({ default: 0 }) onboardingStep: number;
  @Column({ nullable: true }) envelopeId: string;
  @Column({ nullable: true }) signToken: string;
  @Column({ nullable: true }) spouseToken: string;
  @Column({ default: false }) holderSigned: boolean;
  @Column({ default: false }) spouseSigned: boolean;
  @Column({ nullable: true }) plaftNote: string;
  @Column({ nullable: true }) plaftAsk: string;
  @Column({ nullable: true }) plaftFile: string;
  @Column({ default: false }) listOnu: boolean;
  @Column({ default: false }) listOfac: boolean;
  @Column({ nullable: true }) plaftDecidedAt: Date;
  @CreateDateColumn() createdAt: Date;
}

@Entity('properties')
export class Property {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Column() city: string;
  @Column() kind: string;
  @Column({ default: 'USD' }) currency: string;
  @Column(num) price: number;
  @Column(num) unitPrice: number;
  @Column({ default: 20 }) unitsTotal: number;
  @Column({ type: 'numeric', precision: 6, scale: 2, default: 0, transformer: num.transformer }) yieldPct: number;
  @Column({ default: 'draft' }) status: string;
  @Column({ nullable: true }) closeDate: string;
  @Column(num) monthlyRent: number;
  @Column(num) monthlyExpenses: number;
  @Column({ nullable: true }) notary: string;
  @Column({ nullable: true }) occupancy: string;
  @Column({ nullable: true }) contractUntil: string;
  @Column({ default: 'g1' }) gradient: string;
  @Column({ default: 'building' }) icon: string;
  @Column({ nullable: true }) note: string;
  @Column(num) salePrice: number;
  @Column({ default: 0 }) voteYes: number;
  @Column({ nullable: true }) voteEnds: string;
  @Column({ type: 'numeric', precision: 6, scale: 2, default: 0, transformer: num.transformer }) valuationPct: number;
  @CreateDateColumn() createdAt: Date;
}

@Entity('commitments')
export class Commitment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() code: string;
  @Column() userId: string;
  @Column() propertyId: string;
  @Column({ default: 1 }) units: number;
  @Column(num) amount: number;
  @Column({ default: 'USD' }) currency: string;
  @Column({ default: 'pending_approval' }) status: string;
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: num.transformer }) valuation: number;
  @Column(num) rentAccumulated: number;
  @Column({ nullable: true }) rejectReason: string;
  @CreateDateColumn() createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) decidedAt: Date;
}

@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: string;
  @Column({ default: 'USD' }) currency: string;
  @Column(num) available: number;
  @Column(num) settled: number;
  @Column(num) rentAccumulated: number;
}

@Entity('movements')
export class Movement {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: string;
  @Column({ default: 'USD' }) currency: string;
  @Column() concept: string;
  @Column({ nullable: true }) reference: string;
  @Column(num) amount: number;
  @CreateDateColumn() createdAt: Date;
}

@Entity('deposits')
export class Deposit {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() code: string;
  @Column() userId: string;
  @Column(num) amount: number;
  @Column({ default: 'USD' }) currency: string;
  @Column() operationNumber: string;
  @Column({ nullable: true }) originBank: string;
  @Column({ nullable: true }) originAccount: string;
  @Column({ nullable: true }) fileName: string;
  @Column({ default: 'pending' }) status: string;
  @Column({ nullable: true }) rejectReason: string;
  @Column({ default: false }) duplicate: boolean;
  @CreateDateColumn() createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) decidedAt: Date;
}

@Entity('payout_accounts')
export class PayoutAccount {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: string;
  @Column() bank: string;
  @Column({ default: 'Ahorros' }) accountType: string;
  @Column({ default: 'USD' }) currency: string;
  @Column() accountNumber: string;
  @Column() cci: string;
  @Column() holder: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('withdrawals')
export class Withdrawal {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() code: string;
  @Column() userId: string;
  @Column() payoutAccountId: string;
  @Column(num) amount: number;
  @Column({ default: 'USD' }) currency: string;
  @Column({ default: 'pending' }) status: string;
  @Column({ nullable: true }) confirmCode: string;
  @Column({ nullable: true }) rejectReason: string;
  @CreateDateColumn() createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) decidedAt: Date;
}

@Entity('offers')
export class Offer {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() code: string;
  @Column() propertyId: string;
  @Column() sellerId: string;
  @Column({ nullable: true }) buyerId: string;
  @Column({ default: 1 }) units: number;
  @Column(num) price: number;
  @Column(num) referencePrice: number;
  @Column({ default: 'USD' }) currency: string;
  @Column({ default: 'internal_window' }) status: string;
  @Column({ default: false }) reserved: boolean;
  @Column({ type: 'timestamptz', nullable: true }) windowEnds: Date;
  @Column({ type: 'timestamptz', nullable: true }) retractoEnds: Date;
  @CreateDateColumn() createdAt: Date;
}

@Entity('retractos')
export class Retracto {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() offerId: string;
  @Column() userId: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('votes')
export class Vote {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() propertyId: string;
  @Column() userId: string;
  @Column() choice: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: string;
  @Column() title: string;
  @Column() body: string;
  @Column({ default: false }) read: boolean;
  @CreateDateColumn() createdAt: Date;
}

@Entity('complaints')
export class Complaint {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() code: string;
  @Column() name: string;
  @Column() email: string;
  @Column({ nullable: true }) document: string;
  @Column({ nullable: true }) phone: string;
  @Column({ nullable: true }) address: string;
  @Column({ default: 'reclamo' }) kind: string;
  @Column({ nullable: true }) service: string;
  @Column({ nullable: true }) amount: string;
  @Column() detail: string;
  @Column({ nullable: true }) request: string;
  @Column({ default: 'open' }) status: string;
  @Column({ nullable: true }) response: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('alerts')
export class Alert {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() title: string;
  @Column() detail: string;
  @Column({ default: 'media' }) severity: string;
  @Column({ default: 'open' }) status: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('rent_runs')
export class RentRun {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() propertyId: string;
  @Column() period: string;
  @Column(num) gross: number;
  @Column(num) expenses: number;
  @Column(num) net: number;
  @Column({ default: 'draft' }) status: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('settings')
export class Setting {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() key: string;
  @Column() value: string;
}

@Entity('sequences')
export class Sequence {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() name: string;
  @Column({ default: 1000 }) value: number;
}
