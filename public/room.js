const socket = io().connect("/");
const clients = {};
const attachments = [];
CHUNK_SIZE = 1000 * 1000;


var peer = new Peer({
  host: '/',
  port: location.hostname === 'localhost' ? 3001 : 443,
  path: '/peerjs',
  proxied: location.hostname !== 'localhost',
  debug: 0
});

peer.on("open", (id) => {
  socket.emit("join-room", ROOM_ID, id);
});

socket.on("room-started", () => {
  app.infoText.show();
  app.connectingText.hide();
  app.passwordModal.open(ROOM_ID, "It's recommended to set a password for your space.", password => {
    if (password) {
      socket.emit("set-password", ROOM_ID, password);
    }
  });
});

socket.on("password-required", () => {
  app.passwordModal.open(ROOM_ID, "Password Required", (password) => {
    socket.emit("join-room", ROOM_ID, peer.id, password);
  }, true);
});

socket.on("password-incorrect", () => {
  app.passwordModal.showError("Password Incorrect");
});

socket.on("password-correct", () => {
  app.passwordModal.close();
  app.lockIcon.setIcon("lock").setTextColor("success");
});

socket.on("error-set-password", (msg) => {
  app.passwordModal.showError(msg);
});

socket.on("password-set", () => {
  app.passwordModal.close();
  app.lockIcon.setIcon("lock").setTextColor("success");
});

socket.on("password-changed", (msg) => {
  window.location.reload();
});

socket.on("user-connected", (userId) => {
  const connection = peer.connect(userId, { reliable: true });

  connection.on("data", (data) => {
    processData(data, connection);
  });

  connection.on("open", () => {
    clients[userId] = connection;
    app.activeUsers.setText(`${Object.keys(clients).length + 1}`);
    clearTimeout(app.users.timeout);
    app.users.setTooltip(`Guest ${Object.keys(clients).length + 1} connected`, { trigger: "manual", placement: "bottom" }).showTooltip();
    app.users.timeout = setTimeout(() => {
      app.users.hideTooltip();
    }, 3000);
  });

  connection.on("close", () => {
    delete clients[userId];
    app.activeUsers.setText(`${Object.keys(clients).length + 1}`);
    for (let i = attachments.length - 1; i >= 0; i--) {
      if (attachments[i].owner === userId) {
        attachments.splice(i, 1);
      }
    }
    reloadAttachmentsPanel();
  });
});


// Client
peer.on("connection", (connection) => {
  connection.on("data", (data) => {
    processData(data, connection);
  });

  connection.on("close", () => {
    delete clients[connection.peer];
    app.activeUsers.setText(`${Object.keys(clients).length + 1}`);
    for (let i = attachments.length - 1; i >= 0; i--) {
      if (attachments[i].owner === connection.peer) {
        attachments.splice(i, 1);
      }
    }
    reloadAttachmentsPanel();
  });

  connection.on("open", () => {
    clients[connection.peer] = connection;
    app.activeUsers.setText(`${Object.keys(clients).length + 1}`);
    if (connection === Object.values(clients)[0]) {
      connection.send({ requestMeta: true });
    }
    app.infoText.show();
    app.connectingText.hide();
  });
});

function processData(data, connection) {
  if (data.requestMeta) {
    const meta = attachments.map((attachment) => {
      return {
        id: attachment.id,
        name: attachment.name,
        size: attachment.size,
        type: attachment.type,
        text: attachment.text,
        owner: attachment.owner,
      };
    });
    return connection.send({ meta });
  }
  if (data.meta) {
    attachments.length = 0;
    attachments.push(...data.meta);
    reloadAttachmentsPanel();
    return;
  }
  if (data.removeAttachment) {
    attachments.splice(attachments.findIndex(a => a.id === data.removeAttachment), 1);
    app.attachmentsPanel.removeChild(app[`attachment-${data.removeAttachment}`]);
    attachments.length ? app.logo.hide() : app.logo.show();
    return;
  }
  if (data.addAttachments) {
    for (const attachment of data.addAttachments) {
      if (attachment.file) {
        attachment.file = new File([attachment.file], attachment.name, { type: attachment.type });
      }
      attachments.push(attachment);
      app.attachmentsPanel.addChild(
        createAttachmentCard(attachment)
      );
    }
    attachments.length ? app.logo.hide() : app.logo.show();
    return;
  }
  if (data.requestAttachment) {
    const attachment = attachments.find(a => a.id === data.requestAttachment);
    const chunkCount = Math.ceil(attachment.size / CHUNK_SIZE);
    connection.send({
      attachment: {
        id: attachment.id,
        chunkCount
      }
    });
    sendFile(connection, {
      attachment: {
        id: attachment.id,
        idx: 0,
      },
    }, attachment.file, attachment.id);
    return;
  }
  if (data.attachment) {
    let progress = app[`progress-${data.attachment.id}`];
    const progressbar = app[`progressbar-${data.attachment.id}`];
    if (progress && data.attachment.idx !== undefined) { // continue receiving file
      if (!attachments.find(a => a.id === progress.attachment.id)) {
        progressbar.setProgress(0).animated(0).hide();
        app[`spinner-${progress.attachment.id}`].hide();
        app[`download-${progress.attachment.id}`].show();
        delete app[`progress-${data.attachment.id}`];
        progress = null;
        return;
      }
      progress.data = data.attachment;
      receiveFile(progress);
      progressbar.setProgress(Math.round((progress.chunks.size / progress.chunkCount) * 100));
      if (progress.chunkCount === progress.chunks.size) {
        progress.attachment.file = new File(Array.from(progress.chunks.values()), progress.attachment.name, { type: progress.attachment.type });
        progressbar.animated(0);
        app[`spinner-${progress.attachment.id}`].hide();
        app[`download-${progress.attachment.id}`].show();
        delete app[`progress-${data.attachment.id}`];
        download(progress.attachment.file);
        progress = null;
      }
    }
    else if (data.attachment.id && data.attachment.chunkCount) { // start receiving file
      const attachment = attachments.find(a => a.id === data.attachment.id);
      if (!attachment) {
        return;
      }
      app[`progress-${data.attachment.id}`] = {
        chunks: new Map(),
        receivedSize: 0,
        attachment,
        chunkCount: data.attachment.chunkCount,
      };
      app[`progressbar-${attachment.id}`].setProgress(0).show().animated();
    }
    return;
  }
  connection.close();
}

function sendFile(connection, data, file, attachmentId) {
  let offset = 0;

  function sendNextChunk() {
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    data.attachment.chunk = chunk;
    connection.send(data);
    offset += chunk.size;

    if (offset < file.size && attachments.find(a => a.id === attachmentId)) {  // make sure the attachment is not deleted
      data.attachment.idx++;
      sendNextChunk();
    }
  }

  sendNextChunk();
}

function receiveFile(progress) {
  progress.chunks.set(progress.data.idx, progress.data.chunk);
  progress.receivedSize += progress.data.chunk.byteLength;
  return progress;
}

function download(file) {
  const blob = new Blob([file], { type: file.type });
  const url = URL.createObjectURL(blob);

  // downloadModal.open(url, file.name)
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
}

window.addEventListener("beforeunload", (event) => {
  event.preventDefault();

  socket.close();
  peer.destroy();

  // Included for legacy support, e.g. Chrome/Edge < 119
  event.returnValue = "";
});

app.setBgColor("dark").setTextColor("light").setOverflow("hidden").addChildren(
  new Column().snapToBreakpoints().setOverflow("hidden").addChildren(
    new Nav().stretchX().setOverflow("hidden").addChildren(
      new NavLink("", "/").setColor("light").addChildren(
        new Row().setGap(10).addChildren(
          new Icon("rocket-takeoff").setFontSize(1.2, "rem"),
          new Text("SpaceDrop").setFontSize(1.2, "rem").setFontWeight("lighter")
        )
      ),
      new NavLink("", "/").setColor("warning").addSpacing("ms-auto").addChildren(
        new Row().setGap(5).addChildren(
          new Icon("unlock").setRef(app, "lockIcon").setFontSize(1.2, "rem"),
        )
      ).onClick((self, e) => {
        e.preventDefault();
        app.passwordModal.open(ROOM_ID, "Set Password", password => {
          socket.emit("set-password", ROOM_ID, password);
        });
      }),
      new NavLink("", "/").setRef(app, "users").setColor("light").setPointerInteraction("none")
        .addChildren(
          new Row().setGap(5).addChildren(
            new Icon("people").setFontSize(1.2, "rem"),
            new Text("1").setRef(app, "activeUsers").setFontSize(1, "rem"),
          )
        ).onClick((self, e) => {
          e.preventDefault();
        }),
      new NavLink("", "/").setColor("light").addChildren(
        new Row().setGap(10).addChildren(
          new Icon("info-circle").setFontSize(1.2, "rem"),
        )
      ).onClick((self, e) => {
        e.preventDefault();
        app.infoModal.open();
      }),
    ),
    new Column().setRef(app, "body").setMaxWidth(800).setOverflow("hidden").addSpacing("py-5", "px-1").setGap(10).addChildren(
      new Column().addSpacing("p-2").setOverflow("hidden").setRound(5).setStyle("border", "thick dashed #6c757d").addChildren(
        new Column().setRef(app, "logo").setOverflow("hidden").justifyItems("center").addSpacing("m-auto").addChildren(
          new Icon("rocket-takeoff").setFontSize(5, "rem"),
          new DisplayHeading(4, `${ROOM_ID}'s space`).setOverflow("hidden").setFontSize(2, "rem").alignText("center"),
          new Row().setRef(app, "connectingText").stretch("none", "none").setGap(10).addChildren(
            new Spinner().setColor("muted").small(),
            new Text("Connecting...").setFontSize(1, "rem").setFontWeight("lighter").setTextColor("muted").fontItalic(1)
          ),
          new Text("Drop something here...").hide().alignText("center").setRef(app, "infoText").setFontSize(1, "rem").setFontWeight("lighter").setTextColor("muted").fontItalic(1)
        ),
        new Column().setRef(app, "attachmentsPanel").stretchY("none").alignItems("end").setGap(40).addSpacing("px-4", "py-3").setOverflow("auto"),
      )
        .addEventListener("dragover", (e) => {
          e.preventDefault(e);
        }).addEventListener("drop", (e) => {
          e.preventDefault();
          var files = e.dataTransfer.files;
          if (files.length) {
            const _attachments = [];
            for (const file of files) {
              const attachment = {
                id: Math.random().toString(36).substring(2, 15),
                name: file.name,
                size: file.size,
                type: file.type,
                owner: peer.id,
                file,
              };
              _attachments.push({ ...attachment, file: null });
              attachments.push(attachment);
              app.attachmentsPanel.addChild(createAttachmentCard(attachment));
            }
            for (const client of Object.keys(clients)) {
              clients[client].send({ addAttachments: _attachments });
            }
            attachments.length ? app.logo.hide() : app.logo.show();
          }
        }),
      new Column().row("md").addSpacing("px-2").stretchY("none").alignItems("start").addChildren(
        new Text(`Space name: ${ROOM_ID}`).setFontSize(1, "rem").setTextColor("muted").fontItalic(1),
        new Row().stretchY("none").stretchX().stretchX("auto", "sm").setGap(20).addSpacing("ms-auto").addChildren(
          new Button().stretchX().stretchX("auto", "sm").setOverflow("hidden").addSpacing("mt-3").setButtonSize("lg").setContent(
            new Row().justifyItems("center").setOverflow("hidden").setGap(10).addChildren(
              new Icon("upload").setFontSize(1.2, "rem"),
              new Text("Drop Files").setOverflow("hidden").setFontSize(1.2, "rem").setFontWeight("lighter")
              // .display(0).display(1, "sm")
            )
          ).onClick(() => {
            app.fileInput.click();
          }),
          new Button().stretchX().stretchX("auto", "sm").setOverflow("hidden").addSpacing("mt-3").setButtonSize("lg").setContent(
            new Row().justifyItems("center").setGap(10).setOverflow("hidden").addChildren(
              new Icon("files").setFontSize(1.2, "rem"),
              new Text("Paste Text").setOverflow("hidden").setFontSize(1.2, "rem").setFontWeight("lighter")
              // .display(0).display(1, "sm")
            )
          ).onClick(() => {
            app.textModal.open();
          })
        ),
      ),
      new Input("file").setAttribute("multiple", "").setRef(app, "fileInput").hide().addEventListener("change", e => {
        var files = e.target.files;
        if (files.length) {
          const _attachments = [];
          for (const file of files) {
            const attachment = {
              id: Math.random().toString(36).substring(2, 15),
              name: file.name,
              size: file.size,
              type: file.type,
              owner: peer.id,
              file,
            };
            _attachments.push({ ...attachment, file: null });
            attachments.push(attachment);
            app.attachmentsPanel.addChild(createAttachmentCard(attachment));
          }
          for (const client of Object.keys(clients)) {
            clients[client].send({ addAttachments: _attachments });
          }
          attachments.length ? app.logo.hide() : app.logo.show();
        }
      }),

    )
  )
).render();

function reloadAttachmentsPanel() {
  app.attachmentsPanel.clearChildren();
  for (const attachment of attachments) {
    app.attachmentsPanel.addChild(
      createAttachmentCard(attachment)
    );
  }
  attachments.length ? app.logo.hide() : app.logo.show();
}

function reloadClients() {
  for (const client of Object.keys(clients)) {
    const meta = attachments.map((attachment) => {
      return {
        id: attachment.id,
        name: attachment.name,
        size: attachment.size,
        type: attachment.type,
        text: attachment.text,
        owner: attachment.owner,
      };
    });
    clients[client].send({ meta });
  }
}


function createAttachmentCard(attachment) {
  // const color = getColor(attachment.owner)
  return new Column().setRef(app, `attachment-${attachment.id}`).setPositioning("relative").setBgColor("light").setTextColor("muted").setRound(4).addChildren(
    new Icon("x").setBgColor("secondary").setShadow("lg").setRound("circle").setFontSize(1.8, "rem").setTextColor("light").setCursor("pointer").setPositioning("absolute").setPosition({ top: -10, right: -10 })
      .onClick(() => {
        attachments.splice(attachments.findIndex(_attachment => _attachment.id === attachment.id), 1);
        app.attachmentsPanel.removeChild(app[`attachment-${attachment.id}`]);
        for (const client of Object.keys(clients)) {
          clients[client].send({ removeAttachment: attachment.id });
        }
        attachments.length ? app.logo.hide() : app.logo.show();
      }),
    new Column().stretchY("none").setRound(4).setHeight(20).setPointerInteraction("none").setOverflow("hidden").setPositioning("absolute").setPosition(["bottom", "right"]).addChildren(
      new Progressbar().setHeight(5).setProgress(100).setColor("primary").setRef(app, `progressbar-${attachment.id}`).setPositioning("absolute").setPosition(["bottom", "right"]).hide().apply(self => {
        attachment.owner === peer.id && self.show();
      }).striped().animated(0)
    ),
    new Row().stretchY("none").setGap(10).addSpacing("p-4").addChildren(
      new Column().stretch("none", "none").setOverflow("hidden").alignItems("start").setGap(5).addChildren(
        new Text(attachment.name).setFontSize(1.2, "rem").setTextWrap("nowrap"),
        new Text(`Size: ${(attachment.size / 1000000).toFixed(2)} MB`).setFontSize(1, "rem")
      ),
      new Row().stretch("none", "none").setGap(5).addSpacing("ms-auto").addChildren(
        attachment.text && new Icon("files").setFontSize(2, "rem").setCursor("pointer").addSpacing("pe-4").apply(self => {
          self.setTooltip("Copied!", { trigger: "manual", placement: "top", onHide: () => { self.tooltipTimeout = undefined; } })
            .onClick((btn, e) => {
              e.preventDefault();
              if (navigator.clipboard) {
                navigator.clipboard.writeText(attachment.text).then(() => {
                  if (!self.tooltipTimeout) {
                    self.tooltipTimeout = setTimeout(() => {
                      self.hideTooltip();
                    }, 1000);
                    self.showTooltip();
                  }
                });
              }
            });
        }),
        new Icon("download").setRef(app, `download-${attachment.id}`).setFontSize(2, "rem").setCursor("pointer").addSpacing("pe-4").onClick(() => {
          if (attachment.file) {
            download(attachment.file);
          }
          else {
            clients[attachment.owner].send({ requestAttachment: attachment.id });
            app[`spinner-${attachment.id}`].show();
            app[`download-${attachment.id}`].hide();
          }
        }),
        new Column().setRef(app, `spinner-${attachment.id}`).hide().addChildren(
          new Spinner(),
          new Text("Receiving...").setFontSize(.8, "rem").fontItalic(1)
        ),
      )
    ),
    attachment.text && new Column().alignItems("end").setGap(10).addSpacing("p-4").stretchY("none").addChildren(
      new Row().setMaxHeight(200).setBgColor("white").addSpacing("p-2").setRound(4).setBorder("all").setOverflow("auto").addChild(
        new Text(attachment.text).setStyle("white-space", "pre").setFontSize(1.2, "rem"),
      ),
    ),
  );
}

function getColor(clientId) {
  let idx = Object.keys(clients).indexOf(clientId) + 1;
  return (["primary", "info", "success", "secondary", "warning", "danger"])[idx];
}