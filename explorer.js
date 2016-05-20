hljs.initHighlightingOnLoad();

var output;
var cppEditor = null;
var wastEditor = null;

function createBanner() {
  function resize() {
    var pattern = Trianglify({
      height: 64,
      width: window.innerWidth,
      cell_size: 40
    });
    pattern.canvas(document.getElementById('banner'));  
  }
  var width = $(window).width();
  $(window).resize(function(){
     if($(this).width() != width){
        width = $(this).width();
        resize();
     }
  });
  resize();
}

var gui;
function createSettings() {
  var load;
  var urlParameters = getUrlParameters();
  if (urlParameters["settings"]) {
    load = JSON.parse(urlParameters["settings"]);
  }
  gui = new dat.GUI({ autoPlace: false, width: 280, load: load });
  document.getElementById('settingsContainer').appendChild(gui.domElement);
}

var cppOptions = {
  'Optimization Level': 3
};

function setDefaultEditorSettings(editor) {
  editor.setTheme("ace/theme/github");
  editor.getSession().setUseSoftTabs(true);
  editor.getSession().setTabSize(2);
}
function createCppEditor() {
  cppEditor = ace.edit("cppCodeContainer");
  cppEditor.getSession().setMode("ace/mode/c_cpp");
  setDefaultEditorSettings(cppEditor);
  cppEditor.commands.addCommand({
    name: 'assembleCommand',
    bindKey: {win: 'Ctrl-Enter',  mac: 'Command-Enter'},
    exec: function(editor) {
      compile();
    },
    readOnly: true // false if this command should not apply in readOnly mode
  });

  gui.remember(cppOptions);
  var clangSettings = gui.addFolder('Clang / LLVM Settings');
  clangSettings.add(cppOptions, 'Optimization Level', { "0": 0, "1": 1, "2": 2, "3": 3 });
  clangSettings.open();
}

function createWastEditor() {
  wastEditor = ace.edit("wastCodeContainer");
  wastEditor.getSession().setMode("ace/mode/lisp");
  setDefaultEditorSettings(wastEditor);
  wastEditor.commands.addCommand({
    name: 'assembleCommand',
    bindKey: {win: 'Ctrl-Enter',  mac: 'Command-Enter'},
    exec: function(editor) {
      assemble();
    },
    readOnly: true // false if this command should not apply in readOnly mode
  });
}

function begin() {
  createSettings();
  createBanner();
  createCppEditor();
  createWastEditor();
  createExamples();
  output = document.getElementById('x86Code');
}


document.getElementById('toggleSettings').onclick = toggleSettings;
document.getElementById('shareCpp').onclick = share.bind(null, "cpp");
document.getElementById('shareWast').onclick = share.bind(null, "wast");
document.getElementById('compileC').onclick = compile.bind(null, "c");
document.getElementById('compile').onclick = compile.bind(null, "cpp");
document.getElementById('assemble').onclick = assemble;
document.getElementById('beautify').onclick = beautify;
document.getElementById('download').onclick = download;

var isBinaryenInstantiated = false;

function captureOutput(fn) {
  var old = console.log;
  var str = [];
  console.log = function(x) {
    str.push(x);
  };
  fn();
  console.log = old;
  return str.join("\n");
}

var settingsAreOpen = false;
function toggleSettings() {
  if (settingsAreOpen) {
    $('#settingsContainer').css({"display": "none", "visibility": "hidden"});
  } else {
    $('#settingsContainer').css({"display": "block", "visibility": "visible"});
  }
  settingsAreOpen = !settingsAreOpen;
}

function beautify() {
  if (typeof Binaryen === "undefined") {
    lazyLoad("lib/binaryen.js", go)
  } else {
    go();
  }

  function go() {
    if (!isBinaryenInstantiated) {
      Binaryen = Binaryen();
      isBinaryenInstantiated = true;
    }
    var wast = wastEditor.getValue();
    var module = new Binaryen.Module();
    var parser = new Binaryen.SExpressionParser(wast);
    var s_module = parser.get_root().getChild(0);
    var builder = new Binaryen.SExpressionWasmBuilder(module, s_module);

    wast = captureOutput(function() {
      Binaryen.WasmPrinter.prototype.printModule(module);
    });
    wastEditor.setValue(wast, 1);
    var interface_ = new Binaryen.ShellExternalInterface();
    var instance = new Binaryen.ModuleInstance(module, interface_);
  }
}

function download() {
  if (document.getElementById('downloadLink').href != document.location) {
    document.getElementById("downloadLink").click();
  }
}

function lazyLoad(s, cb) {
  document.getElementById("spinner").style.visibility = 'visible';
  document.getElementById("spinnerLabel").innerHTML = "Loading " + s;
  var d = window.document;
  var b = d.body;
  var e = d.createElement("script");
  e.async = true;
  e.src = s;
  b.appendChild(e);
  e.onload = function () {
    document.getElementById("spinnerLabel").innerHTML = "";
    document.getElementById("spinner").style.visibility = "hidden";
    cb.call(this);
  }
}

function share(type) {
  var url = location.protocol + '//' + location.host + location.pathname;
  if (type == "cpp") {
    url = url + "?cpp=" + encodeURIComponent(cppEditor.getValue());  
  } else {
    url = url + "?wast=" + encodeURIComponent(wastEditor.getValue());  
  }
  url += "&settings=" + encodeURIComponent(JSON.stringify(gui.getSaveObject()))
  $('#shareURL').fadeTo(500,1);
  shortenUrl(url, function (url) {
    $('#shareURL').val(url).select();
  });
}

function sendRequest(command, cb, message) {
  var xhr = new XMLHttpRequest();
  xhr.addEventListener("load", function () {
    document.getElementById("spinnerLabel").innerHTML = "";
    document.getElementById("spinner").style.visibility = "hidden";
    cb.call(this);
  });
  xhr.open("POST", "//areweflashyet.com/tmp/wasm/service.php", true);
  xhr.setRequestHeader("Content-type", "application/x-www-form-urlencoded")
  xhr.send(command);
  if (message) {
    document.getElementById("spinnerLabel").innerHTML = message;
  }
  document.getElementById("spinner").style.visibility = 'visible';
}

function compile(language) {
  var action = language === "c" ? "c2wast" : "cpp2wast";
  var cpp = cppEditor.getValue();
  sendRequest("input=" + encodeURIComponent(cpp).replace('%20', '+') + "&action=" + action, function () {
    var wast = this.responseText;
    wastEditor.setValue(wast, 1);
    assemble();
  }, "Compiling C/C++ to Wast");
}

function buildDownload() {
  document.getElementById('downloadLink').href = '';
  var wast = wastEditor.getValue();
  if (!/^\s*\(module\b/.test(wast)) {
    return; // Sanity check
  }
  sendRequest("input=" + encodeURIComponent(wast).replace('%20', '+') + "&action=wast2wasm", function () {
    var wasm = this.responseText;
    if (wasm.indexOf("WASM binary data") < 0) {
      console.log('Error during WASM compilation: ' + wasm);
      return;
    }
    document.getElementById('downloadLink').href = "data:;base64," + wasm.split('\n')[1];
  }, "Compiling Wast to Wasm");
}

function assemble() {
  var wast = wastEditor.getValue();
  if (wast.indexOf("module") < 0) {
    console.log("Doesn't look like a wasm module.");
    output.innerHTML = "";
    document.getElementById('downloadLink').href = '';
    return;
  }
  if (typeof capstone === "undefined") {
    lazyLoad("lib/capstone.x86.min.js", go);
  } else {
    go();
  }
  function go() {
    sendRequest("input=" + encodeURIComponent(wast).replace('%20', '+') + "&action=wast2assembly", function () {
      var json = JSON.parse(this.responseText);
      if (typeof json === "string") {
        var parseError = "wasm text error: parsing wasm text at ";
        if (json.indexOf(parseError) == 0) {
          var location = json.substring(parseError.length).split(":");
          var line = Number(location[0]) - 1;
          var column = Number(location[1]) - 1;
          var mark = wastEditor.markText({
            line: line,
            ch: column
          }, {
            line: line,
            ch: 1000
          }, {
            className: "wasm-error"
          });
          setTimeout(function() {
            mark.clear();
          }, 5000);
        }
        output.innerHTML = json;
        return;
      }
      var s = "";
      var cs = new capstone.Cs(capstone.ARCH_X86, capstone.MODE_64);
      for (var i = 0; i < json.regions.length; i++) {
        var region = json.regions[i];
        s += region.name + ":\n\n";
        var csBuffer = decodeRestrictedBase64ToBytes(region.bytes);
        var instructions = cs.disasm(csBuffer, region.entry);
        instructions.forEach(function(instr) {
          s += padRight(instr.mnemonic + " " + instr.op_str, 28, " ");
          s += "; " + toAddress(instr.address) + " " + toBytes(instr.bytes) + "\n";
        });
        s += "\n";
      }
      output.innerHTML = s;
      hljs.highlightBlock(output);
      cs.delete();

      buildDownload();
    }, "Assembling Wast to x86");
  }

  function padRight(s, n, c) {
    while (s.length < n) {
      s = s + c;
    }
    return s;
  }

  function padLeft(s, n, c) {
    while (s.length < n) {
      s = c + s;
    }
    return s;
  }

  function toAddress(n) {
    var s = n.toString(16);
    while (s.length < 6) {
      s = "0" + s;
    }
    return "0x" + s;
  }

  function toBytes(a) {
    return a.map(function (x) { return padLeft(Number(x).toString(16), 2, "0"); }).join(" ");
  }
};

// Divider Resizing
var divider2storage = $("#cppContainer").width();

$(".divider").draggable({
  axis: "x",
  containment: $("#contentContainer"),
  drag: function(e, ui) {
    if (ui.helper[0].id === "divider-1") {
      $("#x86Container").css("flex", "0 1 " + $("#x86Container").width() + "px"); 
      $("#wastContainer").css("flex", "1");
      $("#cppContainer").css("flex", "0 1 " + (ui.offset.left - 20) + "px");
    } else if (ui.helper[0].id === "divider-2") {
      $("#cppContainer").css("flex", "0 1 " + $("#cppContainer").width() + "px");
      $("#x86Container").css("flex", "1");
      $("#wastContainer").css("flex", "0 1 " + (divider2storage + ui.position.left) + "px");
    }
  },
  stop: function(e, ui) {
    if (ui.helper[0].id === "divider-2") {
      divider2storage = divider2storage + ui.position.left;
    } else {
      divider2storage = $("#wastContainer").width();
    }
  }
});

var cppExamples = {
  "Q_rsqrt": `float Q_rsqrt(float number) {
  long i;
  float x2, y;
  const float threehalfs = 1.5F;

  x2 = number * 0.5F;
  y  = number;
  i  = *(long *) &y;
  i  = 0x5f3759df - (i >> 1);
  y  = *(float *) &i;
  y  = y * (threehalfs - (x2 * y * y));
  y  = y * (threehalfs - (x2 * y * y));

  return y;
}`,
  "testFunction": `int testFunction(int* input, int length) {
  int sum = 0;
  for (int i = 0; i < length; ++i) {
    sum += input[i];
  }
  return sum;
}`,
  "fact": `double fact(int i) {
  long long n = 1;
  for (;i > 0; i--) {
    n *= i;
  }
  return (double)n;
}`,
  "virtual": `struct A {
  A();
  ~A();
  virtual void virtual_member_function();
};
 
A *ctor() {
  return new A();
}
void dtor(A *a) {
  delete a;
}
void call_member_function(A *a) {
  a->virtual_member_function();
}`,
  "popcnt": `int main(int a) {
  return __builtin_popcount(a);
}`
}

// Do stuff if we have URL params.

function createExamples() {
  var el = document.getElementById("cppExamples");
  for (var k in cppExamples) {
    var option = document.createElement("option");
    option.text = k;
    option.value = k;
    el.add(option);
  }
  el.addEventListener("change", function () {
    cppEditor.setValue(cppExamples[this.value], 1);
    compile();
  });

  var urlParameters = getUrlParameters();
  if (urlParameters["cpp"]) {
    cppEditor.setValue(urlParameters["cpp"], 1);
    compile();
  } else if (urlParameters["wast"]) {
    wastEditor.setValue(urlParameters["wast"], 1);
    assemble();
  } else {
    cppEditor.setValue(cppExamples["popcnt"], 1);
    compile();
  }
}

function getUrlParameters() {
  var url = window.location.search.substring(1);
  url = url.replace(/\/$/, ""); // Replace / at the end that gets inserted by browsers.
  var params = {};
  url.split('&').forEach(function (s) {
    var t = s.split('=');
    params[t[0]] = decodeURIComponent(t[1]);
  });
  return params;
};

// URL Shortening

function googleJSClientLoaded() {
  gapi.client.setApiKey("AIzaSyDF8nSRXwQKWZct5Tr5wotbLF3O8SCvjZU");
  gapi.client.load('urlshortener', 'v1', function () {
    shortenUrl(googleJSClientLoaded.url, googleJSClientLoaded.done);
  });
}

function shortenUrl(url, done) {
  if (!window.gapi || !gapi.client) {
    googleJSClientLoaded.url = url;
    googleJSClientLoaded.done = done;
    $(document.body).append('<script src="//apis.google.com/js/client.js?onload=googleJSClientLoaded">');
    return;
  }
  var request = gapi.client.urlshortener.url.insert({
    resource: {
        longUrl: url
    }
  });
  request.then(function (resp) {
    var id = resp.result.id;
    done(id);
  }, function () {
    done(url);
  });
}
