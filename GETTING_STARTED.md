# Getting started

This guide takes you from nothing to a running whiteboard on your own computer. It takes about five minutes. Once it is running, the [README](README.md) explains how to draw.

## What you need

- **Python 3.** Nothing else to install: the app uses only Python's standard library. It has been developed and tested with Python 3.14, and should run on 3.8 or newer.
- **Git**, to download the project.
- **A current web browser:** Chrome, Edge, Firefox or Safari. The whiteboard runs in your browser, served by a small program on your own computer. Nothing is sent over the internet.

To check what you have, open a terminal (on Windows: Command Prompt or PowerShell) and run:

```
python3 --version
git --version
```

On Windows, Python is usually `py` instead of `python3`: try `py --version`. If either command is not found, install it first: Python from [python.org/downloads](https://www.python.org/downloads/) (on Windows, tick "Add python.exe to PATH" in the installer), Git from [git-scm.com/downloads](https://git-scm.com/downloads).

## 1. Get the project

Go to the folder you want the project in, then clone it. If you have an SSH key set up with GitHub:

```
git clone git@github.com:JCampDevel/whiteboard.git
```

Otherwise, use HTTPS:

```
git clone https://github.com/JCampDevel/whiteboard.git
```

Either way you get a new folder called `whiteboard`. Go into it:

```
cd whiteboard
```

If git says the repository was not found or asks for a password, you probably need to be given access: ask the project's owner.

## 2. Start it

From inside the `whiteboard` folder:

```
python3 -m whiteboard
```

(On Windows: `py -m whiteboard`.)

You should see something like:

```
Whiteboard on http://127.0.0.1:8000/  Ctrl+C to stop
```

and a browser tab opens at the start screen, which offers **New project…** and **Open project…**. If no tab opens, copy the address (`http://127.0.0.1:8000/`) into your browser.

Run the command from the project folder (the one containing `README.md`), not from inside the inner `whiteboard` folder, or Python won't find the app.

Leave the terminal open while you work: closing it, or pressing **Ctrl+C** in it, stops the whiteboard. Save your work first (see below).

## 3. Try it

1. On the start screen click **New project…**, type a name such as `My first diagram`, and click **Create**.
1. Click **Controller** in the toolbar, then click on the canvas. A Controller appears, with its Control Algorithm and Process Model inside.
2. Click **Controlled Process** and click somewhere below it.
3. Hover over the Controller: small circles appear on its edges. Drag from one onto the Controlled Process to draw a Control Action.
4. Click **▲ Tables** at the bottom to see the tables. Double-click a name to change it.
5. Click **Save** (or press Ctrl+S). Then **Close project** takes you back to the start screen, where **Open project…** opens it again.

The [README](README.md) covers everything else: Feedback arrows, moving and editing arrows, colours, the dark theme, choosing what the diagram shows, and saving copies.

## Where your work is saved

Each diagram is a project, saved as one file: `My first diagram.json` in the folder you chose when you created it. The project's name is shown in the toolbar.

**Your changes are only saved when you click Save** (or press Ctrl+S). Until then the project's name has a dot after it and the status says **Unsaved changes**. If you click **Close project** or close the browser tab with unsaved changes, you are asked first.

**Save copy…** saves the diagram as it is now under another name, for example a snapshot before a big change. You carry on working on your project; saving it later doesn't change the copy.

You can also start the app straight into a project, skipping the start screen: `python3 -m whiteboard --file pump-system.json` (created if it doesn't exist).

Diagram files are plain JSON: you can read them in a text editor or keep them in git. If you keep projects inside this project's folder, note that only `diagram.json` is in `.gitignore`.

## Options

```
python3 -m whiteboard --help
```

| Option | What it does |
|---|---|
| `--file NAME.json` | Go straight into this project instead of the start screen (the file is created if it doesn't exist). |
| `--port 9000` | Use a different port, if 8000 is already in use. |
| `--no-browser` | Don't open a browser tab; go to the address yourself. |

## Getting updates

From the project folder:

```
git pull
```

Then stop the app (Ctrl+C) and start it again. Diagrams made with older versions open and are upgraded automatically; it's still a good idea to **Save copy…** first.

## Running the tests

```
python3 -m unittest discover -s tests -t .
```

The tests use temporary files and a random port only; they never touch your diagram. They cover the Python side (the diagram rules, tables, saving and the server); the drawing in the browser is not covered by automated tests.

## If something goes wrong

| Problem | What to do |
|---|---|
| `python3: command not found` | Use `python` or, on Windows, `py`. If none work, install Python (see above). |
| `No module named whiteboard` | You are in the wrong folder. `cd` into the project folder, the one containing `README.md`. |
| `Address already in use` | Something else (perhaps another copy of the whiteboard) is using port 8000. Stop it, or start with `--port 9000`. |
| The browser shows "This site can't be reached" | The app isn't running. Check the terminal: start it again, and look for an error message. |
| Open project, or the start screen, says a file **can't be opened** | The file is damaged or isn't a whiteboard diagram. The message says what is wrong. Fix the file, or open another one. |
| The New / Open / Save copy dialog says the server can't be reached | Same as below: the app has stopped. Start it again. |
| Status says **Not saved: the app's server can't be reached** | The terminal running the app was closed or stopped. Don't close the tab: start the app again with `--file` and the same project, then click Save in the tab you still have open. |
| The page looks old after `git pull` | Restart the app, then reload the page. |
