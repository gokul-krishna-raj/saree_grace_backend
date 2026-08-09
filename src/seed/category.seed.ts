import 'dotenv/config';
import mongoose from 'mongoose';
import { Category } from '../models/Category';

type CategorySeed = {
  name: string;
  slug: string;
  description: string;
  image: {
    url: string;
    publicId: string;
  };
  isActive: boolean;
};

const categories: CategorySeed[] = [
  {
    name: 'Soft Silk Sarees',
    slug: 'soft-silk-sarees',
    description:
      'Explore soft silk sarees in elegant colours and designs for weddings, festivals and special occasions.',
    image: {
      url: '/images/categories/soft-silk-sarees.webp',
      publicId: 'categories/soft-silk-sarees',
    },
    isActive: true,
  },
  {
    name: 'Silk Cotton Sarees',
    slug: 'silk-cotton-sarees',
    description:
      'Shop comfortable silk cotton sarees suitable for daily wear, office wear and festive occasions.',
    image: {
      url: '/images/categories/silk-cotton-sarees.webp',
      publicId: 'categories/silk-cotton-sarees',
    },
    isActive: true,
  },
  {
    name: 'Cotton Sarees',
    slug: 'cotton-sarees',
    description:
      'Discover comfortable cotton sarees in traditional colours, prints, borders and everyday designs.',
    image: {
      url: '/images/categories/cotton-sarees.webp',
      publicId: 'categories/cotton-sarees',
    },
    isActive: true,
  },
  {
    name: 'Silk Sarees',
    slug: 'silk-sarees',
    description:
      'Browse elegant silk sarees for weddings, festivals, ceremonies and traditional celebrations.',
    image: {
      url: '/images/categories/silk-sarees.webp',
      publicId: 'categories/silk-sarees',
    },
    isActive: true,
  },
  {
    name: 'Wedding Sarees',
    slug: 'wedding-sarees',
    description:
      'Find beautiful wedding sarees with festive colours, decorative borders and traditional designs.',
    image: {
      url: '/images/categories/wedding-sarees.webp',
      publicId: 'categories/wedding-sarees',
    },
    isActive: true,
  },
  {
    name: 'Bridal Sarees',
    slug: 'bridal-sarees',
    description:
      'Explore bridal sarees designed for wedding ceremonies, receptions and special bridal occasions.',
    image: {
      url: '/images/categories/bridal-sarees.webp',
      publicId: 'categories/bridal-sarees',
    },
    isActive: true,
  },
  {
    name: 'Silver Zari Sarees',
    slug: 'silver-zari-sarees',
    description:
      'Shop sarees featuring silver zari details, decorative borders and elegant festive patterns.',
    image: {
      url: '/images/categories/silver-zari-sarees.webp',
      publicId: 'categories/silver-zari-sarees',
    },
    isActive: true,
  },
  {
    name: 'Kalyani Cotton Sarees',
    slug: 'kalyani-cotton-sarees',
    description: 'Discover Kalyani cotton sarees with comfortable fabrics and traditional designs.',
    image: {
      url: '/images/categories/kalyani-cotton-sarees.webp',
      publicId: 'categories/kalyani-cotton-sarees',
    },
    isActive: true,
  },
  {
    name: 'Tissue Silk Sarees',
    slug: 'tissue-silk-sarees',
    description:
      'Browse lightweight tissue silk sarees for festive events, parties and celebrations.',
    image: {
      url: '/images/categories/tissue-silk-sarees.webp',
      publicId: 'categories/tissue-silk-sarees',
    },
    isActive: true,
  },
  {
    name: 'Art Silk Sarees',
    slug: 'art-silk-sarees',
    description:
      'Explore affordable art silk sarees in attractive colours and occasion-ready designs.',
    image: {
      url: '/images/categories/art-silk-sarees.webp',
      publicId: 'categories/art-silk-sarees',
    },
    isActive: true,
  },
  {
    name: 'Semi-Silk Sarees',
    slug: 'semi-silk-sarees',
    description:
      'Shop semi-silk sarees that combine an elegant appearance with comfortable styling.',
    image: {
      url: '/images/categories/semi-silk-sarees.webp',
      publicId: 'categories/semi-silk-sarees',
    },
    isActive: true,
  },
  {
    name: 'Fancy Sarees',
    slug: 'fancy-sarees',
    description:
      'Discover fancy sarees in modern colours, prints and designs for parties and casual occasions.',
    image: {
      url: '/images/categories/fancy-sarees.webp',
      publicId: 'categories/fancy-sarees',
    },
    isActive: true,
  },
  {
    name: 'Kerala Cotton Sarees',
    slug: 'kerala-cotton-sarees',
    description: 'Browse Kerala cotton sarees with simple, comfortable and traditional styling.',
    image: {
      url: '/images/categories/kerala-cotton-sarees.webp',
      publicId: 'categories/kerala-cotton-sarees',
    },
    isActive: true,
  },
  {
    name: 'Couple Saree and Dhoti Combos',
    slug: 'couple-saree-dhoti-combos',
    description:
      'Shop coordinated saree and dhoti combinations for weddings, festivals, functions and gifting.',
    image: {
      url: '/images/categories/couple-saree-dhoti-combos.webp',
      publicId: 'categories/couple-saree-dhoti-combos',
    },
    isActive: true,
  },
];

async function seedCategories(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error('MONGODB_URI is missing in the environment variables.');
  }

  await mongoose.connect(mongoUri);

  console.log('Connected to MongoDB.');

  const operations = categories.map((category) => ({
    updateOne: {
      filter: {
        slug: category.slug,
      },
      update: {
        $set: {
          name: category.name,
          slug: category.slug,
          description: category.description,
          image: category.image,
          isActive: category.isActive,
          parentCategory: null,
        },
      },
      upsert: true,
    },
  }));

  const result = await Category.bulkWrite(operations);

  console.log('Categories seeded successfully.');
  console.log({
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    upsertedCount: result.upsertedCount,
  });

  await mongoose.disconnect();

  console.log('Disconnected from MongoDB.');
}

seedCategories().catch(async (error) => {
  console.error('Category seeding failed:', error);

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  process.exit(1);
});
