const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: [
        "https://swiftbook.web.app",
        // "http://localhost:5173"
    ],
    credentials: true
}));
app.use(express.json());

// ======================================================
// FIREBASE ADMIN SETUP
// ======================================================
const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString("utf8");
const serviceAccount = JSON.parse(decodedKey);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// ======================================================
// TOKEN VERIFY MIDDLEWARE
// ======================================================
const verifyFBToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).send({ message: "Unauthorized" });

    const token = authHeader.split(" ")[1];

    try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded_email = decoded.email;
        req.decoded_uid = decoded.uid;
        next();
    } catch (err) {
        console.error("TOKEN ERROR:", err && err.message ? err.message : err);
        return res.status(401).send({ message: "Invalid Token" });
    }
};

// ======================================================
// MONGODB CONNECTION
// ======================================================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xr2sv5h.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
    maxPoolSize: 20,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 360000,
});

let db, usersCollection, booksCollection, ordersCollection, wishlistCollection, reviewsCollection, paymentCollection;
let dbConnected = false;

async function connectDBWithRetry(retries = 5, delayMs = 2000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await client.connect();
            db = client.db("swiftbook_db");

            usersCollection = db.collection("users");
            booksCollection = db.collection("books");
            ordersCollection = db.collection("orders");
            wishlistCollection = db.collection("wishlist");
            reviewsCollection = db.collection("reviews");
            paymentCollection = db.collection('payments');

            dbConnected = true;
            console.log("MongoDB Connected Successfully");
            return;
        } catch (error) {
            console.error(`MongoDB Connection Error (attempt ${attempt}):`, error && error.message ? error.message : error);
            if (attempt < retries) {
                console.log(`Retrying MongoDB connection in ${delayMs}ms...`);
                await new Promise(r => setTimeout(r, delayMs));
            } else {
                console.error("Exceeded MongoDB connection retries. Exiting process.");
                process.exit(1);
            }
        }
    }
}

// ======================================================
// Simple middleware to ensure DB is ready before handling requests
// ======================================================
function ensureDb(req, res, next) {
    if (!dbConnected || !usersCollection) {
        return res.status(503).send({ message: "Service temporarily unavailable. DB not ready." });
    }
    next();
}

app.use(ensureDb);

// ======================================================
// ROLE CHECK MIDDLEWARES
// ======================================================
const verifyAdmin = async (req, res, next) => {
    try {
        const user = await usersCollection.findOne({ email: req.decoded_email });
        if (!user || user.role !== "admin") return res.status(403).send({ message: "Forbidden" });
        next();
    } catch (err) {
        console.error("verifyAdmin error:", err && err.message ? err.message : err);
        return res.status(500).send({ message: "Server error" });
    }
};

const verifyLibrarian = async (req, res, next) => {
    try {
        const user = await usersCollection.findOne({ email: req.decoded_email });
        if (!user || (user.role !== "librarian" && user.role !== "admin"))
            return res.status(403).send({ message: "Forbidden" });
        next();
    } catch (err) {
        console.error("verifyLibrarian error:", err && err.message ? err.message : err);
        return res.status(500).send({ message: "Server error" });
    }
};

const verifyAdminOrLibrarian = async (req, res, next) => {
    try {
        const user = await usersCollection.findOne({ email: req.decoded_email });
        if (!user || (user.role !== "admin" && user.role !== "librarian"))
            return res.status(403).send({ message: "Admin/Librarian only" });
        next();
    } catch (err) {
        console.error("verifyAdminOrLibrarian error:", err && err.message ? err.message : err);
        return res.status(500).send({ message: "Server error" });
    }
};

// ======================================================
// USERS API
// ======================================================
app.post('/users', async (req, res) => {
    try {
        const user = req.body;
        user.role = "user";
        user.createdAt = new Date();

        const exists = await usersCollection.findOne({ email: user.email });
        if (exists) return res.send({ message: "user exists" });

        const result = await usersCollection.insertOne(user);
        res.send(result);
    } catch (err) {
        console.error("/users POST error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to create user" });
    }
});

app.get('/users', verifyFBToken, verifyAdmin, async (req, res) => {
    try {
        const result = await usersCollection.find().toArray();
        res.send(result);
    } catch (err) {
        console.error("/users GET error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to fetch users" });
    }
});

app.get('/users/:email/role', async (req, res) => {
    try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });
        res.send({ role: user?.role || "user" });
    } catch (err) {
        console.error("/users/:email/role error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to fetch role" });
    }
});

app.patch('/users/role/:id', verifyFBToken, verifyAdmin, async (req, res) => {
    try {
        const { role } = req.body;
        const result = await usersCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { role } }
        );
        res.send(result);
    } catch (err) {
        console.error("PATCH /users/role/:id error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to update role" });
    }
});

app.delete('/users/:id', verifyFBToken, verifyAdmin, async (req, res) => {
    try {
        const result = await usersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
    } catch (err) {
        console.error("DELETE /users/:id error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to delete user" });
    }
});

// ======================================================
// BOOK API
// ======================================================
app.post('/books', verifyFBToken, verifyAdminOrLibrarian, async (req, res) => {
    try {
        const result = await booksCollection.insertOne(req.body);
        res.send(result);
    } catch (err) {
        console.error("POST /books error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to add book" });
    }
});

app.get('/books', verifyFBToken, verifyAdminOrLibrarian, async (req, res) => {
    try {
        const user = await usersCollection.findOne({ email: req.decoded_email });

        const result = (user.role === "admin" || user.role === "librarian")
            ? await booksCollection.find().toArray()
            : await booksCollection.find({ status: "published" }).toArray();

        res.send(result);
    } catch (err) {
        console.error("GET /books error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to fetch books" });
    }
});

app.get('/books/published', async (req, res) => {
    try {
        const result = await booksCollection.find({ status: "published" }).toArray();
        res.send(result);
    } catch (err) {
        console.error("GET /books/published error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to fetch published books" });
    }
});

app.get('/books/published/:id', async (req, res) => {
    try {
        const result = await booksCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!result) return res.status(404).send({ message: "Book not found" });
        res.send(result);
    } catch (err) {
        console.error("GET /books/published/:id error:", err && err.message ? err.message : err);
        res.status(400).send({ message: "Invalid ID" });
    }
});

app.put('/books/:id', verifyFBToken, verifyAdminOrLibrarian, async (req, res) => {
    try {
        const result = await booksCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: req.body }
        );
        res.send(result);
    } catch (err) {
        console.error("PUT /books/:id error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to update book" });
    }
});

app.delete('/books/:id', verifyFBToken, verifyAdmin, async (req, res) => {
    try {
        const result = await booksCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
    } catch (err) {
        console.error("DELETE /books/:id error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to delete book" });
    }
});

// ======================================================
// ORDER API
// ======================================================
app.post('/orders', verifyFBToken, async (req, res) => {
    try {
        const order = req.body;
        order.createdAt = new Date();
        order.status = "pending";
        order.paymentStatus = "unpaid";

        const result = await ordersCollection.insertOne(order);
        res.send(result);
    } catch (err) {
        console.error("POST /orders error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to create order" });
    }
});

app.get('/orders/:email', verifyFBToken, async (req, res) => {
    try {
        if (req.params.email !== req.decoded_email)
            return res.status(403).send({ message: "Forbidden" });

        const result = await ordersCollection.find({ customerEmail: req.params.email }).toArray();
        res.send(result);
    } catch (err) {
        console.error("GET /orders/:email error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to fetch orders" });
    }
});

app.get('/orders', verifyFBToken, verifyLibrarian, async (req, res) => {
    try {
        const result = await ordersCollection.find().toArray();
        res.send(result);
    } catch (err) {
        console.error("GET /orders error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to fetch orders" });
    }
});

app.delete('/orders/:id', verifyFBToken, async (req, res) => {
    try {
        const result = await ordersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
    } catch (err) {
        console.error("DELETE /orders/:id error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to delete order" });
    }
});

app.get("/orders/librarian/:email", verifyFBToken, async (req, res) => {
    try {
        const email = req.params.email;

        const books = await booksCollection.find({ librarianEmail: email }).toArray();

        const bookIds = books.map(book => book._id.toString());
        const orders = await ordersCollection.find({ bookId: { $in: bookIds } }).toArray();

        res.send(orders);
    } catch (err) {
        console.error("GET /orders/librarian/:email error:", err);
        res.status(500).send({ message: "Failed to fetch librarian orders" });
    }
});

app.patch("/orders/:id", verifyFBToken, async (req, res) => {
    try {
        const id = req.params.id;
        const { status } = req.body;

        const result = await ordersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status } }
        );

        res.send({ success: true, status });
    } catch (err) {
        console.error("PATCH /orders/:id error:", err);
        res.status(500).send({ message: "Failed to update order status" });
    }
});

// ======================================================
// WISHLIST API
// ======================================================
app.post('/wishlist', verifyFBToken, async (req, res) => {
    try {
        const wishlist = req.body;
        wishlist.customerEmail = wishlist.userEmail;
        delete wishlist.userEmail;
        wishlist.createdAt = new Date();

        const result = await wishlistCollection.insertOne(wishlist);
        res.send(result);
    } catch (err) {
        console.error("POST /wishlist error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to add to wishlist" });
    }
});

app.get('/wishlist/:email', verifyFBToken, async (req, res) => {
    try {
        if (req.params.email !== req.decoded_email)
            return res.status(403).send({ message: "Forbidden" });

        const result = await wishlistCollection
            .find({ customerEmail: req.params.email })
            .toArray();

        res.send(result);
    } catch (err) {
        console.error("GET /wishlist/:email error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to fetch wishlist" });
    }
});

app.delete('/wishlist/:id', verifyFBToken, async (req, res) => {
    try {
        const result = await wishlistCollection.deleteOne({
            _id: new ObjectId(req.params.id)
        });
        res.send(result);
    } catch (err) {
        console.error("DELETE /wishlist/:id error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to delete wishlist item" });
    }
});

// ======================================================
// REVIEWS API
// ======================================================
app.post('/reviews', verifyFBToken, async (req, res) => {
    try {
        const { bookId, userEmail, rating, comment, userName, userPhoto } = req.body;

        const hasPurchased = await ordersCollection.findOne({
            bookId: bookId,
            customerEmail: userEmail
        });

        if (!hasPurchased) {
            return res.status(403).send({ message: "You must purchase this book to review" });
        }

        const alreadyReviewed = await reviewsCollection.findOne({
            bookId: bookId,
            userEmail: userEmail
        });

        if (alreadyReviewed) {
            return res.status(400).send({ message: "You already reviewed this book" });
        }

        const review = {
            bookId,
            userEmail,
            userName,
            userPhoto,
            rating,
            comment,
            date: new Date()
        };

        const result = await reviewsCollection.insertOne(review);
        res.send(result);
    } catch (error) {
        console.error("POST /reviews error:", error && error.message ? error.message : error);
        res.status(500).send({ message: "Failed to add review" });
    }
});

app.get('/reviews/:bookId', async (req, res) => {
    try {
        const { bookId } = req.params;
        const reviews = await reviewsCollection.find({ bookId }).sort({ date: -1 }).toArray();
        res.send(reviews);
    } catch (err) {
        console.error("GET /reviews/:bookId error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to fetch reviews" });
    }
});

app.get('/reviews/can/:bookId/:email', verifyFBToken, async (req, res) => {
    try {
        const { bookId, email } = req.params;

        const order = await ordersCollection.findOne({
            bookId,
            customerEmail: email
        });

        const review = await reviewsCollection.findOne({
            bookId,
            userEmail: email
        });

        res.send({
            canReview: !!order && !review
        });
    } catch (err) {
        console.error("GET /reviews/can error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Server error" });
    }
});

// ======================================================
// PAYMENT API
// ======================================================
app.post('/create-checkout-session', async (req, res) => {
    try {
        const paymentInfo = req.body;
        const amount = parseInt(paymentInfo.cost) * 100;

        const session = await stripe.checkout.sessions.create({
            line_items: [
                {
                    price_data: {
                        currency: 'EUR',
                        unit_amount: amount,
                        product_data: {
                            name: `Please pay for: ${paymentInfo.bookTitle || paymentInfo.parcelName}`
                        }
                    },
                    quantity: 1,
                },
            ],
            customer_email: paymentInfo.customerEmail,
            mode: 'payment',
            metadata: {
                bookId: paymentInfo.bookId || paymentInfo.parcelId,
                bookTitle: paymentInfo.bookTitle || paymentInfo.parcelName,
            },
            success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
    } catch (error) {
        console.error("Stripe session creation failed", error && error.message ? error.message : error);
        res.status(500).send({ message: "Failed to create Stripe session" });
    }
});

app.patch("/payment-success", verifyFBToken, async (req, res) => {
    try {
        const sessionId = req.query.session_id;
        if (!sessionId) return res.status(400).send({ message: "Missing session_id" });

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // Avoid duplicate record
        const existingPayment = await paymentCollection.findOne({
            transactionId: session.payment_intent
        });

        if (existingPayment) {
            return res.send({
                success: true,
                paymentInfo: existingPayment,
                transactionId: existingPayment.transactionId
            });
        }

        const payment = {
            userId: req.decoded_uid,
            customerEmail: session.customer_email,
            transactionId: session.payment_intent,
            amount: session.amount_total / 100,
            bookId: session.metadata.bookId,
            bookTitle: session.metadata.bookTitle,
            paymentStatus: session.payment_status,
            paidAt: new Date(),
        };

        await paymentCollection.insertOne(payment);

        await ordersCollection.updateOne(
            {
                bookId: session.metadata.bookId,
                customerEmail: session.customer_email
            },
            { $set: { paymentStatus: "paid" } }
        );

        res.send({
            success: true,
            paymentInfo: payment,
            transactionId: session.payment_intent
        });

    } catch (error) {
        console.error("Payment success error:", error && error.message ? error.message : error);
        res.status(500).send({ success: false, message: "Payment failed" });
    }
});

app.get('/payments', verifyFBToken, async (req, res) => {
    try {
        const email = req.query.email;
        if (email !== req.decoded_email) return res.status(403).send({ message: "Forbidden" });

        const payments = await paymentCollection.find({ customerEmail: email }).sort({ paidAt: -1 }).toArray();
        res.send(payments);
    } catch (err) {
        console.error("GET /payments error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to fetch payments" });
    }
});

// ======================================================
// DASHBOARD API
// ======================================================
app.get("/admin-stats", verifyFBToken, verifyAdmin, async (req, res) => {
    try {
        const [usersCount, booksCount, ordersCount, wishlistCount, reviewsCount, paymentsCount] =
            await Promise.all([
                usersCollection.countDocuments(),
                booksCollection.countDocuments(),
                ordersCollection.countDocuments(),
                wishlistCollection.countDocuments(),
                reviewsCollection.countDocuments(),
                paymentCollection.countDocuments(),
            ]);
        res.send({ usersCount, booksCount, ordersCount, wishlistCount, reviewsCount, paymentsCount });
    } catch (err) {
        console.error("GET /admin-stats error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to load admin stats" });
    }
});

app.get("/librarian-stats", verifyFBToken, verifyLibrarian, async (req, res) => {
    try {
        const [
            booksCount,
            pendingOrders,
            paidOrders,
            reviewsCount,
            wishlistCount,
        ] = await Promise.all([
            booksCollection.countDocuments(),
            ordersCollection.countDocuments({ paymentStatus: "unpaid" }),
            ordersCollection.countDocuments({ paymentStatus: "paid" }),
            reviewsCollection.countDocuments(),
            wishlistCollection.countDocuments(),
        ]);

        res.send({
            booksCount,
            pendingOrders,
            paidOrders,
            reviewsCount,
            wishlistCount,
        });
    } catch (err) {
        console.error("GET /librarian-stats error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to load librarian stats" });
    }
});

app.get("/user-stats/:email", verifyFBToken, async (req, res) => {
    try {
        const email = req.params.email;

        if (email !== req.decoded_email) {
            return res.status(403).send({ message: "Forbidden" });
        }

        const [
            orders,
            wishlist,
            reviews,
            payments
        ] = await Promise.all([
            ordersCollection.countDocuments({ customerEmail: email }),
            wishlistCollection.countDocuments({ customerEmail: email }),
            reviewsCollection.countDocuments({ userEmail: email }),
            paymentCollection.countDocuments({ customerEmail: email }),
        ]);

        res.send({
            orders,
            wishlist,
            reviews,
            payments,
        });

    } catch (err) {
        console.error("GET /user-stats error:", err && err.message ? err.message : err);
        res.status(500).send({ message: "Failed to load user stats" });
    }
});

// ======================================================
// PING ROUTE
// ======================================================
app.get("/ping", (req, res) => {
    res.send("pong");
});

// ======================================================
// BASE API
// ======================================================
app.get("/", (req, res) => {
    res.send("SwiftBook server is running");
});

// ======================================================
// START SERVER (only AFTER DB connected)
// ======================================================
(async () => {
    await connectDBWithRetry(5, 2000); // try 5 times, 2s apart
    app.listen(port, () => {
        console.log(`SwiftBook running on port ${port}`);
    });
})();

// ======================================================
// Graceful shutdown
// ======================================================
process.on('SIGINT', async () => {
    console.log('SIGINT received — closing MongoDB client...');
    try {
        await client.close();
        console.log('MongoDB client closed. Exiting process.');
        process.exit(0);
    } catch (err) {
        console.error('Error during MongoDB close:', err && err.message ? err.message : err);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    console.log('SIGTERM received — closing MongoDB client...');
    try {
        await client.close();
        console.log('MongoDB client closed. Exiting process.');
        process.exit(0);
    } catch (err) {
        console.error('Error during MongoDB close:', err && err.message ? err.message : err);
        process.exit(1);
    }
});
