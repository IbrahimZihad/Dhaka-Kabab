-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CHAT_ESCALATION';

-- AlterTable
ALTER TABLE "chat_conversations" ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "escalationReason" TEXT;
