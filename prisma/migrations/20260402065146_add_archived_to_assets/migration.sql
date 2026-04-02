-- AlterTable
ALTER TABLE "Image" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false;
