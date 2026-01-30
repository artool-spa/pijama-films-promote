import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Ensure the special pijamafilms partner exists
  const pijamaFilms = await prisma.partner.upsert({
    where: { partnerId: 'pijamafilms' },
    update: {},
    create: {
      partnerId: 'pijamafilms',
      name: 'Pijama Films',
    },
  });

  console.log('Seeded partner:', pijamaFilms);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
