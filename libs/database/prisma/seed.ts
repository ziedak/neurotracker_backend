import { PostgreSQLClient } from "../src/postgresql";

async function main() {
  const prisma = PostgreSQLClient.getInstance();

  // Clean up existing data
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.product.deleteMany();
  await prisma.userEvent.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.user.deleteMany();

  // Create sample users
  const user1 = await prisma.user.create({
    data: {
      email: "john.doe@example.com",
      name: "John Doe",
    },
  });

  const user2 = await prisma.user.create({
    data: {
      email: "jane.smith@example.com",
      name: "Jane Smith",
    },
  });

  // Create sample products
  const product1 = await prisma.product.create({
    data: {
      name: "Laptop",
      description: "High-performance laptop for developers",
      price: 1299.99,
      currency: "USD",
      sku: "LAPTOP-001",
      category: "Electronics",
    },
  });

  const product2 = await prisma.product.create({
    data: {
      name: "Coffee Mug",
      description: "Premium ceramic coffee mug",
      price: 19.99,
      currency: "USD",
      sku: "MUG-001",
      category: "Home",
    },
  });

  // Create sample carts
  const cart1 = await prisma.cart.create({
    data: {
      userId: user1.id,
      status: "ACTIVE",
      total: 1299.99,
      items: {
        create: [
          {
            productId: product1.id,
            quantity: 1,
            price: 1299.99,
          },
        ],
      },
    },
  });

  const cart2 = await prisma.cart.create({
    data: {
      userId: user2.id,
      status: "ABANDONED",
      total: 39.98,
      items: {
        create: [
          {
            productId: product2.id,
            quantity: 2,
            price: 19.99,
          },
        ],
      },
    },
  });

  // Create sample user sessions
  const session1 = await prisma.userSession.create({
    data: {
      userId: user1.id,
      sessionId: "session_123",
    },
  });

  // Create sample user events
  await prisma.userEvent.create({
    data: {
      userId: user1.id,
      sessionId: session1.id,
      eventType: "page_view",
      pageUrl: "/products/laptop",
      metadata: {
        referrer: "https://google.com",
        device: "desktop",
      },
    },
  });

  await prisma.userEvent.create({
    data: {
      userId: user1.id,
      sessionId: session1.id,
      eventType: "add_to_cart",
      metadata: {
        productId: product1.id,
        quantity: 1,
      },
    },
  });

  console.log("Seed data created successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await PostgreSQLClient.disconnect();
  });
