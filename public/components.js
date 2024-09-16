const { App, Row, Column, DisplayHeading, DropdownLink, Form, FormText, Icon, Input, InputGroup, InputInvalidFeedback, Link, Label, Markdown, Modal, Spinner, Text, Button, Nav, NavLink, Progressbar } = instantui;

const app = new App();

const markdownText = `
## SpaceDrop

SpaceDrop is a simple file exchanging app between devices. 

It uses **WebRTC** to establish a peer-to-peer connection between devices. Files are **directly** sent from one device to another, they are **not** uploaded to any server.

///

#### How to use

1. Enter a space name to join or create a new space.
2. Open the same space on another device.
3. Drag and drop files to the space to exchange them between devices.
4. You can also exchange text from the clipboard.
5. The other device can copy text from the space to the clipboard or download as a text file.

///

#### Privacy

- SpaceDrop does not collect any data. 
- It does not use cookies or any other tracking methods.
- It does not use any analytics or tracking services. 
- It does not use any server to store or transfer data.

///

#### Terms of Service

- SpaceDrop is provided as is, without any warranty.
- The author is not responsible for any damages, loss of data, security or any other issues caused by the use of this app.
- The author reserves the right to change the terms of service at any time without prior notice.

///

#### Support

If you have any questions or suggestions, please contact me at [support@spacedrop.app](mailto:support@spacedrop.app)

`;

class InfoModal extends Modal {
    constructor() {
        super();
        this.setModalSize("lg")
            .scrollable()
            .setCentered();

        this.setHeaderContent(
            new Row().addSpacing("p-3").alignItems("center").setGap(8).addChildren(
                new Icon("rocket-takeoff").setRef(this, "icon").setFontSize(20).scale(-1, 1),
                new Label("SpaceDrop").setRef(this, "label")
            )
        );
        this.setBodyContent(new Row().addSpacing("p-1").addChildren(
            new Markdown().setRef(this, "markdown")
        ));
        this.setFooterContent(new Row().justifyItems("end").addSpacing("p-2").setGap(20).addChildren(
            new Button("Close").setWidth(70).setColor("secondary").onClick(() => {
                this.close();
            }),
        ));
    }

    open(message) {
        this.markdown.setMarkdownText(message || markdownText);
        super.open();
    }
}

app.infoModal = new InfoModal();

class TextModal extends Modal {
    constructor() {
        super();
        this.setModalSize("lg")
            .scrollable()
            .setCentered();

        this.setHeaderContent(
            new Row().addSpacing("p-3").alignItems("center").setGap(8).addChildren(
                new Icon("files").setRef(this, "icon").setFontSize(20).scale(-1, 1),
                new Label("Paste Text").setRef(this, "label")
            )
        );
        this.setBodyContent(new Row().addSpacing("p-1").addChildren(
            new Input("textarea").setRef(this, "input").setPlaceholder("Paste text here").setAttribute("rows", "5").addSpacing("m-3").setStyle("white-space", "pre")
        ));
        this.setFooterContent(new Row().justifyItems("end").addSpacing("p-2").setGap(20).addChildren(
            new Button("Close").setWidth(70).setColor("secondary").onClick(() => {
                this.accept = false;
                this.close();
            }),
            new Button("Ok").setRef(this, "ok").setWidth(70).onClick(() => {
                const text = this.input.getValue();
                // recursively check for existing text files with name text.txt and increment the name if it exists
                let count = 1;
                while (attachments.find(a => a.name === `text${count.toString().padStart(2, "0")}.txt`)) {
                    count++;
                }
                const file = new File([text], `text${count.toString().padStart(2, "0")}.txt`, { type: "text/plain" });
                if (text) {
                    const attachment = {
                        id: Math.random().toString(36).substring(2, 15),
                        name: file.name,
                        size: file.size,
                        type: file.type,
                        text,
                        owner: peer.id,
                        file
                    };
                    attachments.push(attachment);
                    app.attachmentsPanel.addChild(createAttachmentCard(attachment));
                    for (const client of Object.keys(clients)) {
                        clients[client].send({ addAttachments: [attachment] });
                    }
                    this.accept = true;
                    attachments.length ? app.logo.hide() : app.logo.show();
                }
                this.close();
            })
        ));

        this.addEventListener("keyup", e => {
            if (e.key === "Enter" && !e.shiftKey) {
                this.ok.click();
            }
        });
    }

    open() {
        this.input.setValue("");
        this.accept = false;
        super.open();
    }
}

app.textModal = new TextModal();

class PasswordModal extends Modal {
    constructor() {
        super();
        this.setModalSize("md")
            .scrollable()
            .setCentered();

        this.setHeaderContent(
            new Row().addSpacing("p-3").alignItems("center").setGap(8).addChildren(
                new Icon("shield-lock").setRef(this, "icon").setFontSize(20).scale(-1, 1),
                new Text().setRef(this, "label")
            )
        );
        this.setBodyContent(new Row().addSpacing("p-1").addChildren(
            new Form().stretch().addSpacing("p-4").setRef(this, "form").addChildren(
                new InputGroup().addChildren(
                    new Label("Password"),
                    new Input("password").setRef(this, "input").setName("password").required(),
                    new InputInvalidFeedback("Password is required")
                ),
                new FormText().setRef(this, "formText").hide(),
            ).onSubmit(e => {
                const password = this.form.getFormData().get("password");
                this.callback(password);
            })
        ));
        this.setFooterContent(new Row().justifyItems("end").addSpacing("p-2").setGap(20).addChildren(
            new Button("Close").setRef(this, "closeButton").setWidth(70).setColor("secondary").onClick(() => {
                this.accept = false;
                this.close();
            }),
            new Button("Ok").setRef(this, "ok").setWidth(70).onClick(() => {
                this.form.requestSubmit();
            })
        ));

        this.addEventListener("keyup", e => {
            if (e.key === "Enter") {
                this.ok.click();
            }
        });

        this.onHidden(() => {
            this.formText.hide();
            this.form.reset();
            this.staticBackdrop(false);
            this.closeButton.show();
        });
    }

    open(roomId, message, callback, _static) {
        this.roomId = roomId;
        this.label.setText(message);
        this.callback = callback;
        this.accept = false;
        if (_static) {
            this.staticBackdrop();
            this.closeButton.hide();
        }
        super.open();
    }

    showError(message) {
        this.formText.show().setTextColor("danger").setText(message);
        this.timeout && clearTimeout(this.timeout);
        this.timeout = setTimeout(() => {
            this.formText.hide();
        }, 15000);
    }
}

app.passwordModal = new PasswordModal();