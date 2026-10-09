import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AppController } from './app.controller';
import { AuthController } from './auth.controller';
import { DomainService } from './domain.service';
import {
  Alert, Commitment, Complaint, Deposit, Movement, Notification, Offer, PayoutAccount,
  Property, RentRun, Retracto, Sequence, Setting, User, Vote, Wallet, Withdrawal,
} from './entities';

const entities = [
  User, Property, Commitment, Wallet, Movement, Deposit, PayoutAccount, Withdrawal,
  Offer, Retracto, Vote, Notification, Complaint, Alert, RentRun, Setting, Sequence,
];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres' as const,
        url: process.env.DATABASE_URL || 'postgresql://propia:propia_local_dev@127.0.0.1:5432/propia',
        entities,
        synchronize: true,
      }),
    }),
  ],
  controllers: [AuthController, AppController, AdminController],
  providers: [DomainService],
})
export class AppModule {}
