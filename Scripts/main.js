var languageServer = null;
var taskProvider = null;

exports.activate = function() {
    languageServer = new TerraformLanguageServer();
    taskProvider = new TerraformTaskProvider();


    nova.assistants.registerTaskAssistant(taskProvider, {
        "identifier": "terraform-nova",
        "name": "Terraform Tasks"
    });
}

exports.deactivate = function() {
    if (languageServer) {
        languageServer.deactivate();
        languageServer = null;
    }
}

class TerraformTaskProvider {
    provideTasks() {
        const terraformTask = new Task("Terraform")

        terraformTask.setAction(
            Task.Build,
            new TaskProcessAction("/opt/homebrew/bin/terraform", {
                args: ["plan"],
                env: {},
                cwd: nova.workspace.path,
            })
        )

        terraformTask.setAction(
            Task.Run,
            new TaskProcessAction("", {
                args: [],
                env: {},
            })
        )

        terraformTask.setAction(
            Task.Clean,
            new TaskProcessAction("", {
                args: [],
                env: {},
            })
        )


        return [terraformTask]
    }
}

class TerraformLanguageServer {
    constructor() {
        this.languageClient = null;
        this.restartToken = null;
        this.watcher = null;

        nova.config.onDidChange("terraform-nova.language-server-path", (_path) => {
            this.start();
        }, this)

        this.start();

        nova.workspace.onDidChangePath((_path) => {
            this.startWatcher();
        }, this);

        languageServer = this;

        this.startWatcher();
    }

    deactivate() {
        this.stop();

        if (this.watcher) {
            this.watcher.dispose()
            this.watcher = null;
        }

        if (this.restartToken) {
            clearTimeout(this.restartToken)
        }
    }

    startWatcher() {
        if (this.watcher) {
            this.watcher.dispose()
            this.watcher = null;
        }

        let workspacePath = nova.workspace.path;
        if (workspacePath) {
            this.watcher = nova.fs.watch("compile_commands.json", (path) => {
                languageServer.fileDidChange(path);
            });
        }
    }

    start() {
        console.log("Starting client")
        notify("Starting Terraform language server.")

        this.stop();

        let path = nova.config.get("terraform-nova.language-server-path");
        let args = ["serve"];

        if (!path) {
            path = "/opt/homebrew/bin/terraform-ls"
        }

        let serverOptions = {
            path: path,
            args: args,
        };

        let clientOptions = {
            syntaxes: [
                "terraform",
                "Terraform",
                "tf"
            ]
        };

        let client = new LanguageClient("terraform-ls", "Terraform Language Server", serverOptions, clientOptions);

        client.onDidStop((error) => {
            if (error) {
                this.showStoppedUnexpectedlyNotification(error);
            }
        }, this);

        try {
            client.start();

            nova.subscriptions.add(client);
            this.languageClient = client;
        } catch (err) {
            console.error(err);
        }
    }

    stop() {
        notify("Stopping the Terraform language server.")

        let langclient = this.languageClient;
        this.languageClient = null;

        if (langclient) {
            langclient.stop();
            nova.subscriptions.remove(langclient);
        }
    }

    fileDidChange(path) {
        let lastPathComponent = nova.path.basename(path);
        if (lastPathComponent == "compile_commands.json" || lastPathComponent == "compile_flags.txt") {
            this.scheduleRestart()
        }
    }

    scheduleRestart() {
        let token = this.restartToken;
        if (token != null) {
            clearTimeout(token);
        }

        let languageServer = this;
        this.restartToken = setTimeout(() => {
            languageServer.start();
        }, 1000);
    }

    showStoppedUnexpectedlyNotification(error) {
        let request = new NotificationRequest("com.brendanthompson.terraform-nova.terraform-ls.quit-unexpectedly");
        request.title = "Terraform LS Quit Unexpectedly";
        request.body = `The language server encountered an error: ${error}`;
        request.actions = ["Restart", "Ignore"];

        let languageServer = this;

        let promise = nova.notifications.add(request);
        promise.then(reply => {
            if (reply.actionIdx == 0) {
                // Restart server
                languageServer.start();
            }
        });
    }
}

function notify(message) {
    let request = new NotificationRequest("terraform")

    request.title = "Terraform"
    request.body = message

    nova.notifications.add(request)
}
