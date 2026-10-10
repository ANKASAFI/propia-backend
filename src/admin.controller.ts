import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { DomainService } from './domain.service';

@Controller('admin')
export class AdminController {
  constructor(private domain: DomainService) {}

  private async actor(req: Request) {
    return this.domain.require(await this.domain.userFromToken(req.cookies?.propia_session));
  }

  @Get('deposits')
  async deposits(@Req() req: Request, @Query('status') status = 'pending') {
    this.domain.staff(await this.actor(req), ['tesoreria']);
    return this.domain.adminDeposits(status);
  }

  @Post('deposits/:id/approve')
  async approveDeposit(@Req() req: Request, @Param('id') id: string) {
    return this.domain.decideDeposit(await this.actor(req), id, true);
  }

  @Post('deposits/:id/reject')
  async rejectDeposit(@Req() req: Request, @Param('id') id: string, @Body() b: { reason?: string }) {
    return this.domain.decideDeposit(await this.actor(req), id, false, b.reason);
  }

  @Get('withdrawals')
  async withdrawals(@Req() req: Request, @Query('status') status = 'pending') {
    this.domain.staff(await this.actor(req), ['tesoreria']);
    return this.domain.adminWithdrawals(status);
  }

  @Post('withdrawals/:id/approve')
  approveW(@Req() req: Request, @Param('id') id: string) {
    return this.actor(req).then((u) => this.domain.decideWithdrawal(u, id, 'approve'));
  }

  @Post('withdrawals/:id/reject')
  rejectW(@Req() req: Request, @Param('id') id: string, @Body() b: { reason?: string }) {
    return this.actor(req).then((u) => this.domain.decideWithdrawal(u, id, 'reject', b.reason));
  }

  @Post('withdrawals/:id/pay')
  payW(@Req() req: Request, @Param('id') id: string) {
    return this.actor(req).then((u) => this.domain.decideWithdrawal(u, id, 'pay'));
  }

  @Get('commitments')
  async commitments(@Req() req: Request) {
    this.domain.staff(await this.actor(req), ['admin']);
    return this.domain.adminCommitments();
  }

  @Post('commitments/:id/approve')
  approveC(@Req() req: Request, @Param('id') id: string) {
    return this.actor(req).then((u) => this.domain.decideCommitment(u, id, true));
  }

  @Post('commitments/:id/reject')
  rejectC(@Req() req: Request, @Param('id') id: string, @Body() b: { reason?: string }) {
    return this.actor(req).then((u) => this.domain.decideCommitment(u, id, false, b.reason));
  }

  @Post('properties')
  createP(@Req() req: Request, @Body() b: any) {
    return this.actor(req).then((u) => this.domain.saveProperty(u, b));
  }

  @Post('properties/:id')
  updateP(@Req() req: Request, @Param('id') id: string, @Body() b: any) {
    return this.actor(req).then((u) => this.domain.saveProperty(u, b, id));
  }

  @Post('rents')
  rent(@Req() req: Request, @Body() b: any) {
    return this.actor(req).then((u) => this.domain.distributeRent(u, b));
  }

  @Get('rents')
  async rents(@Req() req: Request) {
    this.domain.staff(await this.actor(req), ['operaciones']);
    return this.domain.rentRuns();
  }

  @Post('offers/:id/advance')
  advance(@Req() req: Request, @Param('id') id: string) {
    return this.actor(req).then((u) => this.domain.advanceOffer(u, id));
  }

  @Get('plaft')
  async plaft(@Req() req: Request, @Query('status') status = 'review') {
    this.domain.staff(await this.actor(req), ['cumplimiento']);
    return this.domain.plaftQueue(status);
  }

  @Post('plaft/:id')
  plaftDecide(@Req() req: Request, @Param('id') id: string, @Body() b: { action: 'approve' | 'reject' | 'observe'; note?: string }) {
    return this.actor(req).then((u) => this.domain.decidePlaft(u, id, b.action, b.note));
  }

  @Get('alerts')
  async alerts(@Req() req: Request) {
    this.domain.staff(await this.actor(req), ['cumplimiento']);
    return this.domain.alerts();
  }

  @Post('alerts/:id/ack')
  ack(@Req() req: Request, @Param('id') id: string) {
    return this.actor(req).then((u) => this.domain.ackAlert(u, id));
  }

  @Get('complaints')
  async complaints(@Req() req: Request) {
    this.domain.staff(await this.actor(req), ['admin']);
    return this.domain.complaints();
  }

  @Post('complaints/:id')
  respond(@Req() req: Request, @Param('id') id: string, @Body() b: { response: string }) {
    return this.actor(req).then((u) => this.domain.respondComplaint(u, id, b.response));
  }

  @Get('team')
  async team(@Req() req: Request) {
    this.domain.staff(await this.actor(req), ['admin']);
    return this.domain.team();
  }

  @Post('team')
  invite(@Req() req: Request, @Body() b: any) {
    return this.actor(req).then((u) => this.domain.invite(u, b));
  }

  @Get('investors')
  async investors(@Req() req: Request) {
    this.domain.staff(await this.actor(req), ['operaciones']);
    return this.domain.investors();
  }

  @Get('settings')
  async settings(@Req() req: Request) {
    this.domain.staff(await this.actor(req), ['cumplimiento']);
    return this.domain.settings();
  }

  @Post('settings')
  saveSettings(@Req() req: Request, @Body() b: any) {
    return this.actor(req).then((u) => this.domain.saveSettings(u, b));
  }

  @Get('tasks')
  async tasks(@Req() req: Request) {
    this.domain.staff(await this.actor(req), ['admin', 'tesoreria', 'operaciones', 'cumplimiento']);
    return this.domain.tasks();
  }
}
