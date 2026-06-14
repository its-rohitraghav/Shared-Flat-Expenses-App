const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // 1. Create or Find Group
  const group = await prisma.group.upsert({
    where: { id: 'flatmates-group-id' },
    update: {},
    create: {
      id: 'flatmates-group-id',
      name: 'Flatmates',
      baseCurrency: 'INR'
    }
  });
  console.log(`Created/found group: ${group.name} (${group.id})`);

  // 2. Create Users
  const usersData = [
    { name: 'Aisha', email: 'aisha@flatmates.com' },
    { name: 'Rohan', email: 'rohan@flatmates.com' },
    { name: 'Priya', email: 'priya@flatmates.com' },
    { name: 'Meera', email: 'meera@flatmates.com' },
    { name: 'Sam', email: 'sam@flatmates.com' },
    { name: 'Dev', email: 'dev@visitor.com' },
    { name: 'Kabir', email: 'kabir@visitor.com' } // Dev's friend Kabir
  ];

  const users = {};
  for (const u of usersData) {
    const user = await prisma.user.upsert({
      where: { name: u.name },
      update: {},
      create: {
        name: u.name,
        email: u.email,
        passwordHash: 'hashedpassword123' // placeholder
      }
    });
    users[u.name] = user;
    console.log(`Created/found user: ${user.name}`);
  }

  // 3. Create Group Memberships with correct joined/left timestamps
  const membershipsData = [
    {
      userName: 'Aisha',
      joinedAt: new Date('2026-02-01T00:00:00Z'),
      leftAt: null
    },
    {
      userName: 'Rohan',
      joinedAt: new Date('2026-02-01T00:00:00Z'),
      leftAt: null
    },
    {
      userName: 'Priya',
      joinedAt: new Date('2026-02-01T00:00:00Z'),
      leftAt: null
    },
    {
      userName: 'Meera',
      joinedAt: new Date('2026-02-01T00:00:00Z'),
      leftAt: new Date('2026-03-31T23:59:59Z') // Left end of March
    },
    {
      userName: 'Sam',
      joinedAt: new Date('2026-04-15T00:00:00Z'), // Moved in mid-April
      leftAt: null
    },
    {
      userName: 'Dev',
      joinedAt: new Date('2026-02-01T00:00:00Z'), // Visitor covering Feb 8 weekend and Mar 8-15 Goa trip
      leftAt: new Date('2026-03-15T23:59:59Z')
    },
    {
      userName: 'Kabir',
      joinedAt: new Date('2026-03-11T00:00:00Z'), // Dev's friend Kabir joined for the day
      leftAt: new Date('2026-03-11T23:59:59Z')
    }
  ];

  for (const m of membershipsData) {
    const userId = users[m.userName].id;
    await prisma.groupMembership.upsert({
      where: {
        groupId_userId: {
          groupId: group.id,
          userId: userId
        }
      },
      update: {
        joinedAt: m.joinedAt,
        leftAt: m.leftAt
      },
      create: {
        groupId: group.id,
        userId: userId,
        joinedAt: m.joinedAt,
        leftAt: m.leftAt
      }
    });
    console.log(`Associated ${m.userName} with group. Joined: ${m.joinedAt.toISOString().slice(0, 10)}, Left: ${m.leftAt ? m.leftAt.toISOString().slice(0, 10) : 'Active'}`);
  }

  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
