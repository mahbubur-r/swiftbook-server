const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// ======================================================
// FIREBASE ADMIN SETUP (FIXED)
// ======================================================
const admin = require("firebase-admin");
const serviceAccount = require("./swiftbook-adminsdk.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

// ======================================================
// TOKEN VERIFICATION MIDDLEWARE
// ======================================================
const verifyFBToken = async (req, res, next) => {
    if (!req.headers.authorization) {
        return res.status(401).send({ message: 'unauthorized access' });
    }

    const token = req.headers.authorization.split(' ')[1];

    try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded_email = decoded.email; // store email for later
        next();
    } catch (error) {
        return res.status(401).send({ message: 'invalid token' });
    }
};

// ======================================================
// MONGODB CONNECTION
// ======================================================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xr2sv5h.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

// ======================================================
// SERVER START
// ======================================================
async function run() {
    try {
        await client.connect();
        const db = client.db('swiftbook_db');

        const booksCollection = db.collection('books');
        const usersCollection = db.collection('users');
        const ordersCollection = db.collection('orders');

        // ======================================================
        // ROLE MIDDLEWARES
        // ======================================================

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email;
            const user = await usersCollection.findOne({ email });

            if (!user || user.role !== "admin") {
                return res.status(403).send({ message: "forbidden access" });
            }
            next();
        };

        const verifyLibrarian = async (req, res, next) => {
            const email = req.decoded_email;
            const user = await usersCollection.findOne({ email });

            if (!user || (user.role !== "librarian" && user.role !== "admin")) {
                return res.status(403).send({ message: "forbidden access" });
            }
            next();
        };

        const verifyAdminOrLibrarian = async (req, res, next) => {
            const email = req.decoded_email;
            const user = await usersCollection.findOne({ email });

            if (!user || (user.role !== "admin" && user.role !== "librarian")) {
                return res.status(403).send({ message: "Admin or Librarian access only" });
            }

            next();
        };


        // ============================================================
        // USERS ROUTES
        // ============================================================

        // ➤ Create User (public)
        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = "user";
            user.createdAt = new Date();

            const exists = await usersCollection.findOne({ email: user.email });
            if (exists) return res.send({ message: "user exists" });

            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        // ➤ Get all users (admin only)
        app.get('/users', verifyFBToken, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        // ➤ Update role (admin only)
        app.patch('/users/role/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const { id } = req.params;
            const { role } = req.body;

            const result = await usersCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { role } }
            );
            res.send(result);
        });

        // ➤ Delete user (admin only)
        app.delete('/users/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const result = await usersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        });

        // ============================================================
        // BOOKS ROUTES
        // ============================================================

        // ➤ Create book (librarian or admin only)
        app.post('/books', verifyFBToken, verifyAdminOrLibrarian, async (req, res) => {
            const book = req.body;
            const result = await booksCollection.insertOne(book);
            res.send(result);
        });

        // ➤ Get books (dynamic based on role)
        app.get('/books', verifyFBToken, verifyAdminOrLibrarian, async (req, res) => {
            const email = req.decoded_email;
            const user = await usersCollection.findOne({ email });

            let result;

            if (user.role === "admin" || user.role === "librarian") {
                result = await booksCollection.find().toArray();
            } else {
                result = await booksCollection.find({ status: "published" }).toArray();
            }

            res.send(result);
        });

        // ➤ Published books (public)
        app.get('/books/published', verifyFBToken, async (req, res) => {
            const result = await booksCollection.find({ status: "published" }).toArray();
            res.send(result);
        });

        // ➤ Get books added by librarian
        app.get('/books/by-user/:email', verifyFBToken, verifyAdminOrLibrarian, async (req, res) => {
            const result = await booksCollection.find({ librarianEmail: req.params.email }).toArray();
            res.send(result);
        });

        // ➤ Single book
        app.get('/books/:id', verifyFBToken, async (req, res) => {
            try {
                const book = await booksCollection.findOne({ _id: new ObjectId(req.params.id) });
                if (!book) return res.status(404).send({ message: "book not found" });
                res.send(book);
            } catch {
                res.status(400).send({ message: "invalid book id" });
            }
        });

        // ➤ Update book (librarian/admin)
        app.put('/books/:id', verifyFBToken, verifyAdminOrLibrarian, async (req, res) => {
            const result = await booksCollection.updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: req.body }
            );
            res.send(result);
        });

        // ➤ Delete book (admin only)
        app.delete('/books/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const result = await booksCollection.deleteOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        });

        // ============================================================
        // ORDERS ROUTES
        // ============================================================

        // ➤ Create order
        app.post('/orders', verifyFBToken, async (req, res) => {
            const order = req.body;
            order.createdAt = new Date();
            order.status = "pending";
            order.paymentStatus = "unpaid";

            const result = await ordersCollection.insertOne(order);
            res.send(result);
        });

        // ➤ Get orders by customer email (only self)
        app.get('/orders/:email', verifyFBToken, async (req, res) => {
            if (req.params.email !== req.decoded_email) {
                return res.status(403).send({ message: "forbidden access" });
            }
            const result = await ordersCollection.find({ customerEmail: req.params.email }).toArray();
            res.send(result);
        });

        // ➤ Get all orders (admin only)
        app.get('/orders', verifyFBToken, verifyLibrarian, async (req, res) => {
            const result = await ordersCollection.find().toArray();
            res.send(result);
        });

        // ➤ Delete order (admin only)
        app.delete('/orders/:id', verifyFBToken, verifyLibrarian, async (req, res) => {
            const result = await ordersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        });

    } catch (err) {
        console.error("MongoDB Connection Error:", err);
    }
}
run();

// Root Route
app.get('/', (req, res) => {
    res.send('SwiftBook server is running');
});

// Start Server
app.listen(port, () => {
    console.log(`SwiftBook server is running on port: ${port}`);
});
