const bcrypt = require('bcrypt');
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {});

const { ExpressPeerServer } = require("peer");
app.use("/peerjs", ExpressPeerServer(httpServer, { proxied: true }));

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.json());

app.set('trust proxy', true);
app.disable('x-powered-by');

const rooms = {};

app.get("/", (req, res) => {
  res.render("index", {});
});

app.get("/:room", (req, res) => {
  let roomId = req.params.room?.trim().replace(/[^a-zA-Z0-9-_]/g, "");
  roomId = /^[a-zA-Z0-9-_]{3,16}$/.test(roomId) ? roomId : null;
  roomId ? res.render("room", { roomId }) : res.redirect("/");
});

io.on("connection", (socket) => {
  socket.on("join-room", (roomId, userId, password) => {
    if (rooms[roomId]) {
      if (rooms[roomId].password) {
        if (!password) {
          return socket.emit("password-required");
        }
        if (bcrypt.compareSync(password, rooms[roomId].password)) {
          socket.emit("password-correct");
        }
        else {
          return socket.emit("password-incorrect");
        }
      }
    }
    else {
      rooms[roomId] = {};
      socket.emit("room-started");
    }

    socket.on("set-password", (roomId, password) => {
      if (!roomId || !password) {
        return socket.emit("error-set-password", "Missing required fields");
      }
      if (!rooms[roomId]) {
        return socket.emit("error-set-password", "Invalid room id");
      }
      rooms[roomId].password = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
      socket.emit("password-set");
      socket.to(roomId).emit("password-changed");
    });

    socket.join(roomId);

    socket.timeout(1000).to(roomId).emit("user-connected", userId,);

    socket.on("disconnect", () => {
      socket.to(roomId).emit("user-disconnected", userId);
      if (!io.of("/").adapter.rooms.get(roomId)) {
        delete rooms[roomId];
      }
    });
  });
});

const port = process.env.PORT || 3001;
httpServer.listen(port, () => console.log(`Server listening on port ${port}...`));
