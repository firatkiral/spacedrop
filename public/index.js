app.setBgColor("dark").setTextColor("light").setOverflow("hidden").addChildren(
    new Column().snapToBreakpoints().addChildren(
        new Nav().stretchX().addChildren(
            new NavLink("", "/").setColor("light").addChildren(
                new Row().setGap(10).addChildren(
                    new Icon("rocket-takeoff").setFontSize(1.2, "rem"),
                    new Text("SpaceDrop").setFontSize(1.2, "rem").setFontWeight("lighter")
                )
            ),
            new NavLink("", "/").setColor("light").addSpacing("ms-auto").addChildren(
                new Row().setGap(10).addChildren(
                    new Icon("info-circle").setFontSize(1.2, "rem"),
                )
            ).onClick((self, e) => {
                e.preventDefault();
                app.infoModal.open();
            }),
        ),
        new Column().setRef(app, "body").justifyItems("center").addSpacing("py-5", "px-1").setGap(10).addChildren(
            new Column().stretchY("none").setGap(10).setMaxWidth(400).addChildren(
                new Column().setRef(app, "logo").justifyItems("center").addSpacing("m-auto").addChildren(
                    new Icon("rocket-takeoff").setFontSize(5, "rem"),
                    new DisplayHeading(4, "SpaceDrop").setFontSize(2, "rem"),
                    new Text("Enter a space name to join or create a new space.").setFontSize(1, "rem").setFontWeight("lighter").setTextColor("muted").fontItalic(1).alignText("center")
                  ),
                new InputGroup().setRound("pill").setGroupSize("lg").addChildren(
                    new Input("text").setHeight(70).setRef(app, "roomInput").setPlaceholder("Enter a space name...").setAutocapitalize("off").required().fontItalic(1)
                    .setStyle("border-top-left-radius", "2rem")
                    .setStyle("border-bottom-left-radius", "2rem").addEventListener("keyup", e => {
                        if (e.key === "Enter" && app.roomInput.validate()) {
                            const roomId = app.roomInput.getValue();
                            if (roomId.length === 0) return;
                            window.location.href = `/${roomId}`;
                        }
                    }).setCustomValidation((val) => {
                            val = val.trim().replace(/[^a-zA-Z0-9-_]/g, "");
                            app.roomInput.setValue(val);
                            return /^[a-zA-Z0-9-_]{3,16}$/.test(val) || "Space name must be between 4 and 30 characters long.";
                    }),
                    new Button("Go").setHeight(70).setColor("light").setOutlined(1).setWidth(100).setColor("primary").setStyle("border-top-right-radius", "2rem")
                    .setStyle("border-bottom-right-radius", "2rem").onClick(() => {
                        if (app.roomInput.validate()) {
                            const roomId = app.roomInput.getValue();
                            window.location.href = `/${roomId}`;   
                        }
                    }),
                    new InputInvalidFeedback("Space name must be between 3 and 30 characters long.")
                ),
                new Column().setMinSize(100, 100)
            )
        )
    )
).render();