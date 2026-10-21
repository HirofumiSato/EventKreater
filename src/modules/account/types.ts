/** マイページのアカウント設定で使う型。API の /api/v1/user/profile と対応する。 */
export interface AccountProfile {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  phoneVerified: boolean;
  phoneMasked: string | null;
  hasPassword: boolean;
}

export interface AccountProfileResponse {
  user: AccountProfile;
  isOrganizer: boolean;
  organizerCount: number;
}

export interface ReauthChallenge {
  challengeRequired: true;
  channel: "SMS" | "EMAIL";
  destinationMask: string;
  canUseSms: boolean;
  canUseEmail: boolean;
  attemptsRemaining: number;
  attemptLimit: number;
  lockMinutes: number;
}
