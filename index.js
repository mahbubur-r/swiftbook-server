// ======================================================
// BASIC SETUP
// ======================================================
const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: [
        "http://localhost:5173",
        "https://swiftbook.web.app"
    ],
    credentials: true
}));
app.use(express.json());


// ======================================================
// FIREBASE ADMIN SETUP
// ======================================================
const admin = require("firebase-admin");

// Decode base64 key (required for Render/Railway/Vercel)
const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString("utf8");
const serviceAccount = JSON.parse(decodedKey);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


// ======================================================
// TOKEN VERIFICATION MIDDLEWARE
// ======================================================
const verifyFBToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).send({ message: "unauthorized access" });

    const token = authHeader.split(" ")[1];

    try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded_email = decoded.email;
        next();
    } catch (err) {
        return res.status(401).send({ message: "invalid token" });
    }
};


// ======================================================
// MONGODB CONNECTION
// ======================================================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xr2sv5h.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: false,
        deprecationErrors: true,
    },
});


// ======================================================
// MAIN SERVER FUNCTION
// ======================================================
async function run() {
    try {
        await client.connect();

        const db = client.db("swiftbook_db");
        const booksCollection = db.collection("books");
        const usersCollection = db.collection("users");
        const ordersCollection = db.collection("orders");


        // ======================================================
        // ROLE CHECK MIDDLEWARES
        // ======================================================

        const verifyAdmin = async (req, res, next) => {
            const user = await usersCollection.findOne({ email: req.decoded_email });
            if (!user || user.role !== "admin") return res.status(403).send({ message: "forbidden access" });
            next();
        };

        const verifyLibrarian = async (req, res, next) => {
            const user = await usersCollection.findOne({ email: req.decoded_email });
            if (!user || (user.role !== "librarian" && user.role !== "admin"))
                return res.status(403).send({ message: "forbidden access" });
            next();
        };

        const verifyAdminOrLibrarian = async (req, res, next) => {
            const user = await usersCollection.findOne({ email: req.decoded_email });
            if (!user || (user.role !== "admin" && user.role !== "librarian"))
                return res.status(403).send({ message: "Admin or Librarian access only" });
            next();
        };


        // ======================================================
        // USERS ROUTES
        // ======================================================

        // Create user (public)
        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = "user";
            user.createdAt = new Date();

            const exists = await usersCollection.findOne({ email: user.email });
            if (exists) return res.send({ message: "user exists" });

            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        // Get all users (admin)
        app.get('/users', verifyFBToken, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        // Get user role (public)
        app.get('/users/:email/role', async (req, res) => {
            const email = req.params.email;
            const user = await usersCollection.findOne({ email });
            res.send({ role: user?.role || "user" });
        });

        // Update role (admin)
        app.patch('/users/role/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const { id } = req.params;
            const { role } = req.body;

            const result = await usersCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { role } }
            );
            res.send(result);
        });

        // Delete user (admin)
        app.delete('/users/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const result = await usersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        });


        // ======================================================
        // BOOK ROUTES
        // ======================================================

        // Create book
        app.post('/books', verifyFBToken, verifyAdminOrLibrarian, async (req, res) => {
            const result = await booksCollection.insertOne(req.body);
            res.send(result);
        });

        // Get books (protected — admin/librarian)
        app.get('/books', verifyFBToken, verifyAdminOrLibrarian, async (req, res) => {
            const user = await usersCollection.findOne({ email: req.decoded_email });

            let result;
            if (user.role === "admin" || user.role === "librarian") {
                result = await booksCollection.find().toArray();
            } else {
                result = await booksCollection.find({ status: "published" }).toArray();
            }

            res.send(result);
        });

        // Public published books
        app.get('/books/published', async (req, res) => {
            const result = await booksCollection.find({ status: "published" }).toArray();
            res.send(result);
        });

        // Get books added by librarian
        app.get('/books/by-user/:email', verifyFBToken, verifyAdminOrLibrarian, async (req, res) => {
            const result = await booksCollection.find({ librarianEmail: req.params.email }).toArray();
            res.send(result);
        });

        // Public single published book
        app.get('/books/published/:id', async (req, res) => {
            try {
                const result = await booksCollection.findOne({ _id: new ObjectId(req.params.id) });
                if (!result) return res.status(404).send({ message: "Book not found" });
                res.send(result);
            } catch {
                res.status(400).send({ message: "Invalid book ID" });
            }
        });

        // Update book
        app.put('/books/:id', verifyFBToken, verifyAdminOrLibrarian, async (req, res) => {
            const result = await booksCollection.updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: req.body }
            );
            res.send(result);
        });

        // Delete book
        app.delete('/books/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const result = await booksCollection.deleteOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        });


        // ======================================================
        // ORDER ROUTES
        // ======================================================

        // Create order
        app.post('/orders', verifyFBToken, async (req, res) => {
            const order = req.body;
            order.createdAt = new Date();
            order.status = "pending";
            order.paymentStatus = "unpaid";

            const result = await ordersCollection.insertOne(order);
            res.send(result);
        });

        // Get orders for specific email (only owner)
        app.get('/orders/:email', verifyFBToken, async (req, res) => {
            if (req.params.email !== req.decoded_email)
                return res.status(403).send({ message: "forbidden access" });

            const result = await ordersCollection.find({ customerEmail: req.params.email }).toArray();
            res.send(result);
        });

        // Get all orders (librarian/admin)
        app.get('/orders', verifyFBToken, verifyLibrarian, async (req, res) => {
            const result = await ordersCollection.find().toArray();
            res.send(result);
        });

        // Delete order
        app.delete('/orders/:id', verifyFBToken, async (req, res) => {
            const result = await ordersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        });

    } catch (error) {
        console.error("SERVER ERROR:", error);
    }
}

run();


// ======================================================
// BASE ROUTE
// ======================================================
app.get("/", (req, res) => {
    res.send("SwiftBook server is running");
});


// ======================================================
// START SERVER
// ======================================================
app.listen(port, () => {
    console.log(`SwiftBook running on port ${port}`);
});
