import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private static readonly logger = new Logger(GoogleStrategy.name);

  constructor() {
    const clientID = process.env.GOOGLE_CLIENT_ID ?? '';
    if (!clientID) {
      GoogleStrategy.logger.warn(
        'GOOGLE_CLIENT_ID not set — Google OAuth disabled.',
      );
    }
    super({
      clientID: clientID || 'disabled',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? 'disabled',
      callbackURL:
        process.env.GOOGLE_REDIRECT_URL ??
        'http://localhost:4100/auth/google/callback',
      scope: ['openid', 'email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const email = profile.emails?.[0]?.value ?? '';
    const picture = profile.photos?.[0]?.value;
    done(null, {
      googleId: profile.id,
      email,
      name: profile.displayName,
      picture,
    });
  }
}
