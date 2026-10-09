import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { DomainService } from './domain.service';

@Controller()
export class AppController {
  constructor(private domain: DomainService) {}

  private async actor(req: Request) {
    return this.domain.require(await this.domain.userFromToken(req.cookies?.propia_session));
  }

  @Get('health')
  health() {
    return { ok: true, service: 'propia' };
  }

  @Get('properties')
  async properties(@Req() req: Request, @Query('status') status?: string) {
    const user = await this.domain.userFromToken(req.cookies?.propia_session);
    return this.domain.properties(user, status);
  }

  @Get('properties/:id')
  async property(@Req() req: Request, @Param('id') id: string) {
    const user = await this.domain.userFromToken(req.cookies?.propia_session);
    return this.domain.property(user, id);
  }

  @Post('properties/:id/commitments')
  async commit(@Req() req: Request, @Param('id') id: string, @Body() b: { units: number }) {
    return this.domain.createCommitment(await this.actor(req), id, b.units);
  }

  @Post('commitments/:id/cancel')
  async cancel(@Req() req: Request, @Param('id') id: string) {
    return this.domain.cancelCommitment(await this.actor(req), id);
  }

  @Post('profile')
  async profile(@Req() req: Request, @Body() b: any) {
    return this.domain.saveProfile(await this.actor(req), b);
  }

  @Post('signature')
  async signature(@Req() req: Request) {
    return this.domain.startSignature(await this.actor(req));
  }

  @Get('sign/:token')
  signInfo(@Param('token') token: string) {
    return this.domain.signInfo(token);
  }

  @Post('sign/:token')
  sign(@Param('token') token: string, @Body() b: { who?: 'holder' | 'spouse' }) {
    return this.domain.sign(token, b.who || 'holder');
  }

  @Get('wallet')
  async wallet(@Req() req: Request, @Query('currency') currency = 'USD') {
    return this.domain.walletView(await this.actor(req), currency);
  }

  @Get('movements')
  async movements(@Req() req: Request, @Query('currency') currency = 'USD') {
    return this.domain.movements(await this.actor(req), currency);
  }

  @Post('deposits')
  async deposit(@Req() req: Request, @Body() b: any) {
    return this.domain.createDeposit(await this.actor(req), b);
  }

  @Get('payout-accounts')
  async accounts(@Req() req: Request) {
    return this.domain.payoutAccounts(await this.actor(req));
  }

  @Post('payout-accounts')
  async addAccount(@Req() req: Request, @Body() b: any) {
    return this.domain.addPayout(await this.actor(req), b);
  }

  @Post('withdrawals')
  async withdraw(@Req() req: Request, @Body() b: any) {
    return this.domain.createWithdrawal(await this.actor(req), b);
  }

  @Post('withdrawals/:id/confirm')
  async confirmWithdraw(@Req() req: Request, @Param('id') id: string, @Body() b: { code: string }) {
    return this.domain.confirmWithdrawal(await this.actor(req), id, b.code);
  }

  @Get('portfolio')
  async portfolio(@Req() req: Request) {
    return this.domain.portfolio(await this.actor(req));
  }

  @Post('properties/:id/vote')
  async vote(@Req() req: Request, @Param('id') id: string, @Body() b: { choice: 'yes' | 'no' }) {
    return this.domain.vote(await this.actor(req), id, b.choice);
  }

  @Get('secondary')
  async secondary(@Req() req: Request) {
    return this.domain.secondary(await this.actor(req));
  }

  @Post('secondary')
  async offer(@Req() req: Request, @Body() b: any) {
    return this.domain.createOffer(await this.actor(req), b);
  }

  @Post('secondary/:id/buy')
  async buy(@Req() req: Request, @Param('id') id: string) {
    return this.domain.buyOffer(await this.actor(req), id);
  }

  @Post('secondary/:id/retracto')
  async retracto(@Req() req: Request, @Param('id') id: string) {
    return this.domain.retracto(await this.actor(req), id);
  }

  @Post('secondary/:id/cancel')
  async cancelOffer(@Req() req: Request, @Param('id') id: string) {
    return this.domain.cancelOffer(await this.actor(req), id);
  }

  @Get('notifications')
  async notes(@Req() req: Request) {
    return this.domain.notifications(await this.actor(req));
  }

  @Post('notifications/read')
  async read(@Req() req: Request) {
    return this.domain.readNotifications(await this.actor(req));
  }

  @Post('password')
  async password(@Req() req: Request, @Body() b: { password: string }) {
    return this.domain.changePassword(await this.actor(req), b.password);
  }

  @Post('complaints')
  complaint(@Body() b: any) {
    return this.domain.createComplaint(b);
  }
}
