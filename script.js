var update_count = 1;
var user_type = 0;
var market = null;
var participant = null;
var client = null;
var topic_root = "38674839685/tamu_energy_market_sim"
var game = {"state":"uninitialized"}
var connected = false;
var dataChart = null;
var userRevenue = [];
var userProfits = [];

function randomString(length) {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < length; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

//Data Chart functions

//Initialize the labels and set data (used by client as it is updated frequently)
function updateUserChartData(chart, numPeriod) {

  //Clear Labels
  chart.data.labels = [];

  //Set new labels to num of periods
  for (var i = 0; i < numPeriod; i++)
    chart.data.labels.push(i+1);

  //Set data
  chart.data.datasets[0].data = userRevenue;
  chart.data.datasets[1].data = userProfits;


  chart.update();
}

//Appends Data for every period
function addData(chart, label, data) {
  chart.data.labels.push(label);
  chart.data.datasets.forEach((dataset) => {
      dataset.data.push(data);
  });
  chart.update();
}

function removeData(chart) {
    chart.data.labels.pop();
    chart.data.datasets.forEach((dataset) => {
        dataset.data.pop();
    });
    chart.update();
}

function onConnect_admin() {
    console.log("Connection Success");
    topic_base = topic_root + "/" + market
    topic_offers = topic_root + "/" + market + "/offers"
    client.subscribe(topic_offers, {qos:2});
    clear_status_only("Connected as admin");
    connected = true;
    update();
}

function onConnect_participant() {
    console.log("Connection Success");
    topic_base = topic_root + "/" + market
    topic_offers = topic_root + "/" + market + "/offers"
    client.subscribe(topic_base, {qos:2});
    clear_status_only("Waiting for market initialization...");
    game = {"state":"uninitialized"}
    connected = true;
}

function set_status(msg) {
    document.getElementById("status_bar").innerHTML = msg
}

function clear_status_only(msg) {
    //document.getElementById("section1").innerHTML = "";
    //document.getElementById("section2").innerHTML = "";
    //document.getElementById("section3").innerHTML = "";
    set_status(msg);
}

function onFail(message) {
    console.log("Fail: " + message);
    clear_status_only("Connection failed, try refreshing page.");
}

function connLost() {
    console.log("Conn lost");
    clear_status_only("Connection lost, try refreshing page.");
}

function messageArr_admin(message) {
    console.log(message.payloadString);
    message_obj = JSON.parse(message.payloadString);
    for (var key of Object.keys(message_obj)) {
        if (key == "join" && game.state == "forming")
        {
            player = {id:message_obj[key], money:0, ngens:0};
            player.last_offer = Date.now();
            game.players[message_obj[key]] = player;
            make_participant_list();
            if (game.nplayers == game.options.max_participants)
            {
                close_game_admin();
            }
            return;
        }
        else if (key != "join" && game.state == "running")
        {
            if (game.gens.hasOwnProperty(key)) {
                game.gens[key].offer = message_obj[key];
                owner = game.gens[key].owner;
                if (game.players.hasOwnProperty(owner)) {
                game.players[owner].last_offer_time = Date.now();
                }
                make_participant_list();
                make_generator_list();
            }
        }
    }

}

function close_game_admin() {
    game.state = "full";
    console.log("game filled");
    clear_status_only("Game closed to new participants, start when ready...");
    make_participant_list();
}

function set_running_status() {
    adv_text = "auto-advance paused";
    if (game.auto_advance)
    {
        adv_text = "Auto-advance in " + Math.floor((game.advance_time-Date.now())/1000) + " seconds"
    }
    set_status("Running period " + game.period + " of " + game.options.num_periods + "   :  " + adv_text);
}

function complete_game() {
    game.state = "completed";
    clear_status_only("Game completed after " + game.options.num_periods + " periods. Refresh page to start again.");
    make_participant_list();
    make_generator_list();
    make_period_list();
}

function clear_market() {
    if (game.period == 0) return;
    period = game.periods[game.period-1];
    gen_list = Object.values(game.gens);
    gen_list.sort(function(a,b){return Math.random();});
    gen_list.sort(function(a,b){return a.offer - b.offer;});
    period.marginal_cost = 0;
    load_left = period.load;
    for (var i = 0; i < gen_list.length; i++) {
        var g = gen_list[i];
        period.gens[g.id].offer = g.offer;
        period.gens[g.id].mw = 0;
    }
    for (var i = 0; i < gen_list.length; i++) {
        var g = gen_list[i];
        period.marginal_cost = g.offer;
        period.gens[g.id].offer = g.offer;
        if (g.capacity > load_left) cleared_mw = load_left;
        else cleared_mw = g.capacity;
        period.gens[g.id].mw = cleared_mw;
        load_left -= cleared_mw;
        if (load_left <= 0) break;
    }

    for (var key of Object.keys(game.players)) {
        player = game.players[key];
        period.players[key].revenue = 0;
        period.players[key].costs = 0;
        period.players[key].profit = 0;
        period.players[key].money = player.money;
    }
    for (var i = 0; i < gen_list.length; i++) {
        var g = gen_list[i];
        cleared_mw = period.gens[g.id].mw;
        if (game.options.payment_method == "pay_as_offered")
            revenue = g.offer * cleared_mw;
        else revenue = period.marginal_cost * cleared_mw;
        cost = g.cost * cleared_mw;
        profit = revenue - cost;
        if (game.players.hasOwnProperty(g.owner)) {
            var p = game.players[g.owner];
            var pp = period.players[g.owner];
            p.money += profit;
            pp.revenue += revenue;
            pp.costs += cost;
            pp.profit += profit;
            pp.money += profit;
        }
    }
    console.log(gen_list);
}

function advance_period() {
    console.log("advancing");
    clear_market();
    game.period += 1;
    if (game.period > game.options.num_periods) {
        complete_game();
        return;
    }
    game.last_advance_time = Date.now();
    game.advance_time = Date.now() + game.options.auto_advance_time*1000;
    clear_status_only("");
    set_running_status();
    make_participant_list();
    make_generator_list();
    make_period_list();
}

function distribute_generators() {
    game.gens = {};
    geni = 1;
    for (var key of Object.keys(game.players)) {
        player = game.players[key];
        gen = {"id":"Gen "+geni, "owner":key, "capacity":50, "cost":20, "offer":20};
        game.gens[gen.id] = gen;
        player.ngens += 1;
        geni += 1;
        gen = {"id":"Gen "+geni, "owner":key, "capacity":20, "cost":30, "offer":30};
        game.gens[gen.id] = gen;
        player.ngens += 1;
        geni += 1;
        gen = {"id":"Gen "+geni, "owner":key, "capacity":10, "cost":40, "offer":40};
        game.gens[gen.id] = gen;
        player.ngens += 1;
        geni += 1;
        gen = {"id":"Gen "+geni, "owner":key, "capacity":10, "cost":50, "offer":50};
        game.gens[gen.id] = gen;
        player.ngens += 1;
        geni += 1;
        gen = {"id":"Gen "+geni, "owner":key, "capacity":10, "cost":65, "offer":65};
        game.gens[gen.id] = gen;
        player.ngens += 1;
        geni += 1;
    }
}

function setup_periods() {
    game.periods = [];
    load_list = [0.522441691, 0.472495937, 0.44734451, 0.43918225, 0.524746677, 0.635641158, 0.732903576, 0.789389988, 0.804715331, 0.76067869, 0.708948052, 0.616364574, 0.535339516, 0.488753845, 0.485078364, 0.502676387, 0.58499257, 0.693471822, 0.789035563, 0.842958247, 0.850073775, 0.804827558, 0.74614858, 0.645890024];
    for (i=0; i<game.options.num_periods; i++) {
        period = {number:i+1}
        period.load = Math.floor(game.nplayers*100*load_list[i%24]);
        period.marginal_cost = null;
        period.players = {};
        period.gens = {};
        for (var key of Object.keys(game.players)) {
            player = game.players[key];
            period.players[key] = {"revenue":null, "costs": null, "profit":null, "money":null};
        }
        for (var key of Object.keys(game.gens)) {
            gen = game.gens[key];
            period.gens[key] = {"offer":null, "mw":null};
        }
        game.periods.push(period);
    }
}

function start_game_admin() {
    game.state = "running";
    console.log("starting game");
    game.period = 0;
    game.auto_advance = true;
    distribute_generators();
    setup_periods();
    advance_period();
}

function send_join_request() {
    topic_offers = topic_root + "/" + market + "/offers"
    var message_obj = {"join":participant};
    var message = new Messaging.Message(JSON.stringify(message_obj));
    message.destinationName = topic_offers;
    message.qos = 2;
    message.retained = false;
    client.send(message);
}

function messageArr_participant(message) {
    //console.log(message.payloadString);
    new_game = JSON.parse(message.payloadString);
    if (game.state == new_game.state)
    {
        if (game.state == "forming")
        {
            if (game.players.hasOwnProperty(participant))
            {
                game = new_game;
                clear_status_only("You have entered the market as a participant!");
                make_participant_list();
            }
            else
            {
                game = new_game;
                clear_status_only("Forming: Attempting to Join the Market.");
                make_participant_list();
                send_join_request();
            }
        }
        else if (game.state == "running")
        {
            if (game.period == new_game.period)
            {
                game = new_game;
                set_running_status();
                make_participant_list();
            }
            else
            {
                game = new_game;
                clear_status_only("");
                set_running_status();
                make_participant_list();
                make_generator_list();
                make_period_list();
            }
        }
        game = new_game;
    }
    else
    {
        game = new_game;
        if (game.state == "uninitialized")
        {
            clear_status_only("Waiting for market to come online");
        }
        else if (game.state == "initializing")
        {
            clear_status_only("Waiting for market to open to participants");
        }
        else if (game.state == "forming")
        {
            clear_status_only("Forming: trying to join market");
            make_participant_list();
            send_join_request();
        }
        else if (game.state == "full")
        {
            clear_status_only("The market has been closed to new participants. Waiting for the market to begin");
            make_participant_list();
        }
        else if (game.state == "running")
        {
            clear_status_only("");
            set_running_status();
            make_participant_list();
            make_generator_list();
            make_period_list();
        }
        else if (game.state == "completed")
        {
            clear_status_only("Market complete! See results below --");
            make_participant_list();
            make_generator_list();
            make_period_list();
        }
    }
}

function send_game_state() {
    topic_base = topic_root + "/" + market
    var message = new Messaging.Message(JSON.stringify(game));
    message.destinationName = topic_base;
    message.qos = 2;
    message.retained = false;
    client.send(message);
}

//Once game is 'Started' we want to hide the login screen
// 1 - Hide login
// 2 - Show game info in nav bar
// 3 - Logout button in nav bar
function make_registration_head() {

    //Find, hide, and empty login box
    main = document.getElementById("main");
    main.style.display = 'none';

    //Create Logout Button
    s = document.createElement("input");
    s.setAttribute("type", "submit");
    s.setAttribute("value", "Log Out");
    s.setAttribute("class", "btn btn-outline-secondary btn-sm");

    //Add Logout button
    logout_div = document.getElementById("nav_logout");
    logout_div.appendChild(s);

    //Find username section and put it there
    username_div = document.getElementById("nav_name");
    username_div.innerHTML =  participant.toUpperCase();

    //Show account info and logout Button
    acc_info = document.getElementById("account_info");
    acc_info.classList.remove("invisible");

    //Assign Market Name
    market_info = document.getElementById("market-name");
    market_info.innerHTML = market.toUpperCase()

}

function make_login_form() {
    main = document.getElementById("main");
    main.style.display = ''; //Removes 'none' and shows element

}

function connect_client_admin() {
    host = "broker.mqttdashboard.com"
    port = 8000
    clientId = "client-" + randomString(10)
    client = new Messaging.Client(host, port, clientId);
    client.onConnectionLost = connLost;
    client.onMessageArrived = messageArr_admin;
    var options = {
        timeout: 3,
        keepAliveInterval: 60,
        cleanSession: true,
        useSSL: false,
        onSuccess: onConnect_admin,
        onFailure: onFail
    };
    connected = false;
    client.connect(options);
    clear_status_only("Trying to connect...");
}

function connect_client_participant() {
    host = "broker.mqttdashboard.com"
    port = 8000
    clientId = "client-" + randomString(10)
    client = new Messaging.Client(host, port, clientId);
    client.onConnectionLost = connLost;
    client.onMessageArrived = messageArr_participant;
    var options = {
        timeout: 3,
        keepAliveInterval: 60,
        cleanSession: true,
        useSSL: false,
        onSuccess: onConnect_participant,
        onFailure: onFail
    };
    connected = false;
    client.connect(options);
    clear_status_only("Trying to connect...");
}

function adjust_auto_advance() {
    var autoadv = document.getElementById("auto_advance_check");
    console.log("Checked: " + autoadv.checked);
    game.auto_advance = autoadv.checked;
}

function make_participant_list() {

    //Make game visible
    main_content = document.getElementById("main-content");
    main_content.style.display = '';

    participant_area = document.getElementById("participant-list-section");

    //For easy element insertion
    br = document.createElement("br");
    p1 = document.createElement("p");

    //Admin Tools
    admin_widgets = document.getElementById("admin_widgets");
    admin_widgets.innerHTML = "";

    //Participant List
    participants = document.getElementById("participant-table-body");
    participants.innerHTML = "";

    //Hide profit chart if admin
    if(user_type == 2){
      chart_content = document.getElementById("dataChart");
      chart_content.style.display = 'none';
    }

    //Game info
    game.nplayers = 0;
    max_money = -99999;
    min_money = 99999;

    //Add rows
    for (var key of Object.keys(game.players)) {
        player = game.players[key];
        game.nplayers += 1;
        if (player.money > max_money) max_money = player.money;
        if (player.money < min_money) min_money = player.money;
        if (user_type == 2 || participant == player.id)
        {
            tr = document.createElement("tr");
            td = document.createElement("td");
            td.innerHTML = player.id;
            tr.appendChild(td);

            td = document.createElement("td");
            td.innerHTML = "$" + player.money;
            tr.appendChild(td);

            td = document.createElement("td");
            td.innerHTML = player.ngens;
            tr.appendChild(td);

            td = document.createElement("td");
            if (player.last_offer_time > game.last_advance_time){
              td.innerHTML = "YES";
              td.style.color = "green";
            }
            else{
              td.innerHTML = "NO";
              td.style.color = "red";
            }
            tr.appendChild(td);
            participants.appendChild(tr); //Add Row to table
        }
    }

    //Update Game Info
    num_players_label = document.getElementById("num-players");
    num_players_label.innerHTML = game.nplayers;

    max_money_label = document.getElementById("max-money");
    max_money_label.innerHTML = "$" + max_money;

    min_money_label = document.getElementById("min-money");
    min_money_label.innerHTML = "$" + min_money;

    //If admin
    if(user_type == 2){

      //Show Admin Controls
      document.getElementById("admin-controls").style.display = '';
      document.getElementById("admin-hr").style.display = '';

      if (game.state == "forming")
      {
          s = document.createElement("button");
          s.setAttribute("type", "button");
          s.setAttribute("onclick", "close_game_admin();");
          s.classList.add("btn");
          s.classList.add("btn-primary");
          s.innerHTML = "Close Game";
          admin_widgets.appendChild(s);
      }
      if (game.state == "full")
      {
          s = document.createElement("button");
          s.setAttribute("type", "button");
          s.setAttribute("onclick", "start_game_admin();");
          s.classList.add("btn");
          s.classList.add("btn-primary");
          s.innerHTML = "Start Game";
          admin_widgets.appendChild(s);
      }
      if (game.state == "running")
      {
          s = document.createElement("button");
          s.setAttribute("type", "button");
          s.setAttribute("onclick", "advance_period();");
          s.classList.add("btn");
          s.classList.add("btn-primary");
          s.classList.add("mb-3");
          s.innerHTML = "Advance to Next Period";
          admin_widgets.appendChild(s);

          //Switch
          sw = document.createElement("div");
          sw.classList.add("form-check");
          sw.classList.add("form-switch");

          s = document.createElement("input");
          s.classList.add("form-check-input")
          s.setAttribute("type", "checkbox");
          s.setAttribute("role", "switch");
          s.setAttribute("id", "auto_advance_check");
          s.setAttribute("checked", "true");
          s.setAttribute("onclick", "adjust_auto_advance();");
          sw.appendChild(s);

          l = document.createElement("label");
          l.classList.add("form-check-label")
          l.setAttribute("for", "auto_advance_check");
          l.innerHTML = "Auto-Advance";
          sw.appendChild(l);

          admin_widgets.appendChild(sw);


      }
    }
}

function submit_offers() {

    //Disable offer Button - Enable this line if you want to allow only one offer
    //document.getElementById("submit-offer-button").classList.add("disabled");

    topic_offers = topic_root + "/" + market + "/offers"
    var message_obj = {};
    for (var key of Object.keys(game.gens)) {
        gen = game.gens[key];
        if (participant == gen.owner) {
            offerbox = document.getElementById("gen_offer_"+key);
            offer = parseFloat(offerbox.value);
            if (typeof offer === 'undefined') offer = 200;
            if (offer === null) offer = 200;
            if (isNaN(offer)) offer = 200;
            if (offer > 200) offer = 200;
            if (offer < 0) offer = 0;
            message_obj[key] = offer;
        }
    }
    var message = new Messaging.Message(JSON.stringify(message_obj));
    message.destinationName = topic_offers;
    message.qos = 2;
    message.retained = false;
    client.send(message);
}

function make_period_list() {

    //Make visible
    document.getElementById("period-list").style.display="";

    br = document.createElement("br");

    tHeader = document.getElementById("period-table-header");
    tHeader.innerHTML = "";

    period_data = document.getElementById("period-table-body");
    period_data.innerHTML = "";

    //Column Names
    th = document.createElement("th");
    th.innerHTML = "Number";
    tHeader.appendChild(th);
    th = document.createElement("th");
    th.innerHTML = "Load";
    tHeader.appendChild(th);
    th = document.createElement("th");
    th.innerHTML = "Marginal Price ($/MWh)";
    tHeader.appendChild(th);
    for (var key of Object.keys(game.players)) {
        player = game.players[key];
        if (user_type == 2 || participant == player.id)
        {
            th = document.createElement("th");
            th.innerHTML = key + " Revenue";
            tHeader.appendChild(th);
            th = document.createElement("th");
            th.innerHTML = key + " Costs";
            tHeader.appendChild(th);
            th = document.createElement("th");
            th.innerHTML = key + " Profit";
            tHeader.appendChild(th);
            th = document.createElement("th");
            th.innerHTML = key + " Money";
            tHeader.appendChild(th);
        }
    }

    //Gen Col Names
    for (var key of Object.keys(game.gens)) {
        gen = game.gens[key];
        if (user_type == 2 || participant == gen.owner)
        {
            th = document.createElement("th");
            th.innerHTML = key + " Offer";
            tHeader.appendChild(th);
            th = document.createElement("th");
            th.innerHTML = key + " MW";
            tHeader.appendChild(th);
        }
    }

    //Clear Chart data - will be updated below
    userProfits = [];
    userRevenue = [];

    //Data
    for (var i = 0; i < game.options.num_periods; i++) {

        period = game.periods[i];
        tr = document.createElement("tr");
        td = document.createElement("td");
        td.innerHTML = period.number;
        tr.appendChild(td);
        td = document.createElement("td");
        td.innerHTML = period.load;
        tr.appendChild(td);
        td = document.createElement("td");
        td.innerHTML = period.marginal_cost;
        tr.appendChild(td);

        //Loop through each player
        for (var key of Object.keys(game.players)) {

            //Only add data if relevant to current player or admin
            player = game.players[key];
            if (user_type == 2 || participant == player.id)
            {
                //Add sum data to table
                td = document.createElement("td");
                td.innerHTML = period.players[key].revenue;
                tr.appendChild(td);
                td = document.createElement("td");
                td.innerHTML = period.players[key].costs;
                tr.appendChild(td);
                td = document.createElement("td");
                td.innerHTML = period.players[key].profit;
                tr.appendChild(td);
                td = document.createElement("td");
                td.innerHTML = period.players[key].money;
                tr.appendChild(td);

                //Add sum data to chart only if normal user
                if (user_type != 2){
                  userProfits.push(period.players[key].profit);
                  userRevenue.push(period.players[key].revenue);
                }
                //If Admin
                else{



                }

            }
        }
        for (var key of Object.keys(game.gens)) {
            gen = game.gens[key];
            if (user_type == 2 || participant == gen.owner)
            {
                td = document.createElement("td");
                td.innerHTML = period.gens[key].offer;
                tr.appendChild(td);
                td = document.createElement("td");
                td.innerHTML = period.gens[key].mw;
                tr.appendChild(td);
            }
        }
        period_data.appendChild(tr);
    }

    updateUserChartData(dataChart, game.options.num_periods);

}

function make_generator_list() {
    br = document.createElement("br");

    document.getElementById("generator-list").style.display="";

    generators = document.getElementById("generator-table-body");
    generators.innerHTML = "";

    p1 = document.getElementById("gen-advice");
    if (user_type == 3 && game.state == "running") {
        p1.innerHTML = "Your generators are listed below. Type your offer in the box and click 'submit offers' to submit your offers. Offers must be between $0 and $200. If the table above shows YES, your offers have been accepted. You can change your offer until the market clears at the end of the timer.";
    }

    for (var key of Object.keys(game.gens)) {
        gen = game.gens[key];
        if (user_type == 2 || participant == gen.owner)
        {
            tr = document.createElement("tr");
            td = document.createElement("td");
            td.innerHTML = gen.id;
            tr.appendChild(td);
            td1 = document.createElement("td");
            td1.innerHTML = gen.owner;
            tr.appendChild(td1);
            td = document.createElement("td");
            td.innerHTML = gen.capacity;
            tr.appendChild(td);
            td2 = document.createElement("td");
            td2.innerHTML = gen.cost;
            tr.appendChild(td2);
            td3 = document.createElement("td");
            td3.innerHTML = gen.offer;
            tr.appendChild(td3);
            generators.appendChild(tr);
            if (user_type == 3 && game.state == "running") {
                td3.innerHTML = "";
                inp = document.createElement("input");
                inp.setAttribute("type", "text");
                inp.setAttribute("id", "gen_offer_"+gen.id);
                inp.setAttribute("value", gen.offer);
                td3.appendChild(inp);
            }
        }
    }


    //Button is re-enabled at start of new cycle
    if (user_type == 3 && game.state == "running")
    {
        offerButtonDiv = document.getElementById("gen-offer-button");
        offerButtonDiv.innerHTML = "";

        s = document.createElement("button");
        s.setAttribute("type", "button");
        s.setAttribute("id", "submit-offer-button")
        s.classList.add("btn");
        s.classList.add("btn-primary")
        s.setAttribute("onclick", "submit_offers();");
        s.innerHTML = "Submit Offers";

        offerButtonDiv.append(s);

    }
}

function tableToCSV(tableName) {

	// Variable to store the final csv data
	var csv_data = [];

	// Get each row data
  var table = document.getElementById(tableName);
	var rows = table.getElementsByTagName('tr');
	for (var i = 0; i < rows.length; i++) {

		// Get each column data
		var cols = rows[i].querySelectorAll('td,th');

		// Stores each csv row data
		var csvrow = [];
		for (var j = 0; j < cols.length; j++) {

			// Get the text data of each cell of
			// a row and push it to csvrow
			csvrow.push(cols[j].innerHTML);
		}

		// Combine each column value with comma
		csv_data.push(csvrow.join(","));
	}
	// combine each row data with new line character
	csv_data = csv_data.join('\n');

  downloadCSVFile(csv_data);
}


function downloadCSVFile(csv_data) {

    // Create CSV file object and feed our
    // csv_data into it
    CSVFile = new Blob([csv_data], { type: "text/csv" });

    // Create to temporary link to initiate
    // download process
    var temp_link = document.createElement('a');

    // Download csv file
    temp_link.download = "TAMU_Market_Data.csv";
    var url = window.URL.createObjectURL(CSVFile);
    temp_link.href = url;

    // This link should not be displayed
    temp_link.style.display = "none";
    document.body.appendChild(temp_link);

    // Automatically click the link to trigger download
    temp_link.click();
    document.body.removeChild(temp_link);
}


function open_game_admin() {

    //Log to console for debug
    console.log("Opening game attempt");

    //Hide Options
    admin_options_section = document.getElementById('admin_options');
    admin_options_section.style.display = 'none';

    game.options = {}
    game.options.max_participants = parseInt(document.getElementById("max_participants").value);
    if (!game.options.max_participants) game.options.max_participants = 6;
    if (game.options.max_participants < 2) game.options.max_participants = 2;
    if (game.options.max_participants > 99) game.options.max_participants = 99;
    game.options.num_periods = parseInt(document.getElementById("num_periods").value);
    if (!game.options.num_periods) game.options.num_periods = 24;
    if (game.options.num_periods < 2) game.options.num_periods = 2;
    if (game.options.num_periods > 99) game.options.num_periods = 99;
    game.options.auto_advance_time = parseInt(document.getElementById("auto_advance_time").value);
    if (!game.options.auto_advance_time) game.options.auto_advance_time = 180;
    if (game.options.auto_advance_time < 2) game.options.auto_advance_time = 2;
    if (game.options.auto_advance_time > 9999) game.options.auto_advance_time = 9999;
    game.options.payment_method = document.getElementById("payment_method").value;
    game.state = "forming";
    game.players = {};//fake_player:{id:"fake_player", money:0, ngens:0}};
    clear_status_only("A new market has been formed. When you are ready, close the market to new participants.");
    make_participant_list();
}

function make_game_admin_options() {
    admin_options_section = document.getElementById("admin_options");
    admin_options_section.style.display = '';

    clear_status_only("Signed in as Admin --  Choose your options and then open the game to new participants.");

}

function update() {
    debug_text = "Debug: "
    if (!connected)
    {
        debug_text += " | not connected";
    }
    else if (user_type == 2)
    {
        debug_text += " | admin update";
        if (connected && game.state == "uninitialized")
        {
            make_game_admin_options();
            game.state = "initializing";
        }
        if (connected && game.state == "running")
        {
            set_running_status();
            if (game.auto_advance && Date.now() > game.advance_time)
            {
                advance_period();
            }
        }
        if (connected)
        {
            send_game_state();
        }
    }
    else if (user_type == 3)
    {
        debug_text += " | participant";
    }
    debug_text += " | Update count: " + update_count;
    debug_text += " | Market: " + market
    debug_text += " | Participant: " + participant
    debug_text += " | Time: " + Date.now()
    update_count++;
    //document.getElementById("debug").innerHTML = debug_text;
}

function startup() {
    params = new URLSearchParams(document.location.search);
    market = params.get("market");
    participant = params.get("participant");
    if (!market || !participant)
    {
        make_login_form();
        user_type = 1;
    }else{
        //Login & market info
        make_registration_head();
        if (participant == "admin"){
            user_type = 2;
            connect_client_admin();
        }
        else{
            user_type = 3;
            connect_client_participant();
        }
    }

    update();
    setInterval(update, 1000);

    //Initialize chart
    const ctx = document.getElementById('dataChart');

    dataChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [1, 2, 3, 4, 5, 6, 7, 8, 9 ,10, 11, 12],
        datasets: [
          {
            label: 'Revenue',
            data: [],
            borderWidth: 1,
            tension: 0.1
          },
          {
            label: 'Profit',
            data: [],
            borderWidth: 1,
            tension: 0.1
          }
        ],
      },

      options: {

        scales: {

          y: {

                title: {
                  display: true,
                  text: 'Period Money'
                },
                ticks: {
                    callback: function(value, index, values) {return '$' + value;}
                }

          },

          x: {

                title: {
                  display: true,
                  text: 'Period Number'
                }

          }

        }

      }
    });
}

document.onload = startup();
