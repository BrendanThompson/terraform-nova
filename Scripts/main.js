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
  constructor() {
    this.path = nova.config.get("terraform-nova.terraform-path");

    nova.config.onDidChange("terraform-nova.terraform-path", (path) => {
      if (!nova.fs.access(path, nova.fs.constants.F_OK)) {
        this.dispose();
        notify(
          "Invalid Terraform binary path, please check the path you've inputted.",
          ["Get Terraform", "Ignore"],
          (reply) => {
            switch (reply.actionIdx) {
              case 0:
                nova.openURL("https://developer.hashicorp.com/terraform/downloads")
                break
              case 1:
                break
            }
          }
        )
      } else {
        this.path = path
      }
    })
  }

  provideTasks() {
    if (!this.path) {
      notify(
        "Cannot find Terraform binary, please ensure it is installed.",
        ["Get Help", "Ignore"],
        (reply) => {
          switch (reply.actionIdx) {
            case 0:
              nova.openURL("https://developer.hashicorp.com/terraform/downloads")
              break
            case 1:
              break
          }
        }
      )
      return []
    }

    const terraformTask = new Task("Terraform")

    terraformTask.setAction(
      Task.Build,
      new TaskProcessAction(this.path, {
        args: ["plan"],
        env: {},
        cwd: nova.workspace.path,
      })
    )

    terraformTask.setAction(
      Task.Run,
      new TaskProcessAction(this.path, {
        args: ["apply", "-auto-approve"],
        env: {},
        cwd: nova.workspace.path,
      })
    )

    terraformTask.setAction(
      Task.Clean,
      new TaskProcessAction(this.path, {
        args: ["destroy", "-auto-approve"],
        env: {},
        cwd: nova.workspace.path,
      })
    )


    return [terraformTask]
  }
}

class TerraformLanguageServer {
  constructor() {
    this.languageClient = null;
    this.restartToken = null;

    nova.config.onDidChange("terraform-nova.language-server-path", (_path) => {
      this.start();
    }, this)

    this.start();

    languageServer = this;
  }

  deactivate() {
    this.stop();

    if (this.restartToken) {
      clearTimeout(this.restartToken)
    }
  }

  start() {
    console.log("Starting client")

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
        "terraform-vars"
      ],
      initializationOptions: {
        terraform: {
          //TODO: Refactor to have a shared source of configuration
          path: nova.config.get("terraform-nova.terraform-path"),
        },
        indexing: {
          ignoreDirectoryNames: [
            ".nova"
          ]
        },
      }
    };

    let client = new LanguageClient("terraform-ls", "Terraform Language Server", serverOptions, clientOptions);

    nova.commands.register("terraform-nova.format", (editor) => {
      formatFile(editor, client)
    })

    nova.workspace.onDidAddTextEditor((editor) => {
      return editor.onWillSave((editor) => formatFile(editor, client))
    })

    client.onDidStop((error) => {
      if (error) {
        notify(
          `Terraform language server quit unexpectedly with error: ${error}`,
          ["Restart", "Ignore"],
          (reply) => {
            if (reply.actionIdx == 0) {
              languageServer.start();
            }
          }
        )
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
    let langclient = this.languageClient;
    this.languageClient = null;

    if (langclient) {
      langclient.stop();
      nova.subscriptions.remove(langclient);
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
}

function notify(body, actions, handler) {
  let request = new NotificationRequest("terraform")

  request.title = "Terraform"
  request.body = body
  if (actions) request.actions = actions

  nova.notifications.add(request).then(reply => {
    if (handler) handler(reply)
  }, err => console.error(err))
}

nova.commands.register("terraform-nova.restartLSP", () => languageServer.scheduleRestart())
nova.commands.register("terraform-nova.stopLSP", () => languageServer.stop())

async function formatFile(editor, lspClient) {
  var cmdArgs = {
    textDocument: {
      uri: editor.document.uri,
    },
    options: {
      tabSize: editor.tabLength,
      insertSpaces: editor.softTabs,
    },
  };

  const changes = await lspClient.sendRequest("textDocument/formatting", cmdArgs);

  if (!changes) {
    console.warn("no changes")
    return
  }

  await Edits.applyEdits(editor, changes)
}
