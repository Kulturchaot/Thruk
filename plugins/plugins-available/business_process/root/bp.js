/* initialize all buttons */
function init_bp_buttons() {
    jQuery('A.bp_button').button();
    jQuery('BUTTON.bp_button').button();

    jQuery('.bp_edit_button').button({
        icons: {primary: 'ui-edit-button'}
    });

    jQuery('.bp_save_button').button({
        icons: {primary: 'ui-save-button'}
    });

    if (document.layers) {
      document.captureEvents(Event.MOUSEDOWN);
    }
    document.onmousedown   = bp_context_menu_open;
    document.oncontextmenu = bp_context_menu_open;
    return;
}

/* refresh given business process */
var current_node;
function bp_refresh(bp_id, node_id) {
    bp_active_node = current_node;
    showElement('bp_status_waiting');
    /* adding timestamp makes IE happy */
    var ts = new Date().getTime();
    jQuery('#bp'+bp_id).load('bp.cgi?_=' + ts + '&action=refresh&bp='+bp_id, [], function() {
        hideElement('bp_status_waiting');
        var node = document.getElementById(current_node);
        bp_update_status(null, node);
        jQuery(node).addClass('bp_node_active');
        if(node_id) {
            jQuery('#'+node_id).effect('highlight', {}, 1500);
        }
    });
}

/* unset active node */
function bp_unset_active_node() {
    jQuery('.bp_node_active').removeClass('bp_node_active');
    bp_active_node = undefined;
}

/* close menu */
function bp_context_menu_close_cb() {
    bp_context_menu = false;
    bp_unset_active_node();
}

/* open menu */
var bp_context_menu = false;
var bp_active_node;
function bp_context_menu_open(evt, node) {
    evt = (evt) ? evt : ((window.event) ? event : null);
    var rightclick;
    if (evt.which) rightclick = (evt.which == 3);
    else if (evt.button) rightclick = (evt.button == 2);
    if(rightclick && node) {
        bp_context_menu = true;
        bp_unset_active_node();
        jQuery(node).addClass('bp_node_active');
        bp_active_node = node.id;
        bp_update_status(evt, node);
        jQuery("#bp_menu").menu().css('top', evt.pageY+'px').css('left', evt.pageX+'px');
        bp_menu_restore();
    } else if(node) {
        bp_unset_active_node();
        jQuery(node).addClass('bp_node_active');
        bp_active_node = node.id;
        bp_update_status(evt, node);
    } else if(evt.target && jQuery(evt.target).hasClass('bp_container')) {
        bp_unset_active_node();
    }

    // always allow events on input fields
    if(evt.target.tagName == "INPUT") {
        return true;
    }

    if(bp_context_menu) {
        if (evt.stopPropagation) {
            evt.stopPropagation();
        }
        if(evt.preventDefault != undefined) {
            evt.preventDefault();
        }
        evt.cancelBubble = true;
        return false;
    }
    return true;
}

/* restores menu if possible */
function bp_menu_restore() {
    if(original_menu) { // restore original menu
        jQuery('#bp_menu').html(original_menu);
    }
    showElement('bp_menu', undefined, true, undefined, bp_context_menu_close_cb);
    jQuery('.ui-state-focus').removeClass('ui-state-focus');
}

/* make node renameable */
function bp_show_rename(evt) {
    evt = (evt) ? evt : ((window.event) ? event : null);
    bp_menu_save();
    bp_menu_restore();
    var node = bp_get_node(current_node);
    jQuery('#bp_menu_rename_node').html(
         '<input type="text" value="'+node.label+'" id="bp_rename_text" style="width:100px;" onkeyup="bp_submit_on_enter(event, \'bp_rename_btn\')">'
        +'<input type="button" value="OK" style="width:40px;" id="bp_rename_btn" onclick="bp_confirmed_rename('+node.id+')">'
    );
    document.getElementById('bp_rename_text').focus();
    setCaretToPos(document.getElementById('bp_rename_text'), node.label.length);
    return(bp_no_more_events(evt))
}

/* send rename request */
function bp_confirmed_rename(node) {
    var text = jQuery('#bp_rename_text').val();
    jQuery.post('bp.cgi?action=rename_node&bp='+bp_id+'&node='+node.id+'&label='+text, [], function() {
        bp_refresh(bp_id, node.id);
    });
    hideElement('bp_menu');
}

/* remove node after confirm */
function bp_show_remove() {
    bp_menu_save();
    bp_menu_restore();
    var node = bp_get_node(current_node);
    jQuery('#bp_menu_remove_node').html(
         'Confirm: <input type="button" value="No" style="width: 50px;" onclick="bp_menu_restore()">'
        +'<input type="button" value="Yes" style="width: 40px;" onclick="bp_confirmed_remove('+node.id+')">'
    );
    return false;
}

/* send remoev request */
function bp_confirmed_remove(node) {
    jQuery.post('bp.cgi?action=remove_node&bp='+bp_id+'&node='+node.id, [], function() {
        bp_refresh(bp_id);
    });
    hideElement('bp_menu');
}

/* run command on enter */
function bp_submit_on_enter(evt, id) {
    evt = (evt) ? evt : ((window.event) ? event : null);
    if(evt.keyCode == 13){
        var btn = document.getElementById(id);
        btn.click();
    }
}

/* show node type select */
function bp_show_add_node() {
    hideElement('bp_menu');
    jQuery("#bp_edit_node").dialog({
        modal: true,
        closeOnEscape: true,
        width: 365
    });
    jQuery('.bp_type_btn').button();
    showElement('bp_edit_node');
}

/* show node type select: fixed */
function bp_select_fixed() {
    bp_show_dialog('bp_select_fixed', 430, 200);
    jQuery('.bp_fixed_radio').buttonset();
}

/* show node type select: best */
function bp_select_best() {
    bp_show_dialog('bp_select_best', 430, 130);
}

/* show node type select: worst */
function bp_select_worst() {
    bp_show_dialog('bp_select_worst', 430, 130);
}

/* show add node dialog */
function bp_show_dialog(id, w, h) {
    jQuery("#bp_edit_node").dialog("close");
    jQuery("#"+id).dialog({
        modal: true,
        closeOnEscape: true,
        width: w,
        height: h,
        buttons: [
            { text: 'Back',
              click: function() { jQuery(this).dialog("close"); bp_show_add_node(); },
              icons: { primary: "ui-icon-arrowthick-1-w" },
              'class': 'bp_dialog_back_btn'
            },
            { text: 'Create',
              click: function() { bp_add_node(id+'_form'); jQuery(this).dialog("close"); },
              'class': 'bp_dialog_create_btn'
            }
        ]
    });
}

/* save menu for later restore */
function bp_add_node(formId) {
    var data = jQuery('#'+formId).serializeArray();
    var node = document.getElementById(current_node);
    jQuery.post('bp.cgi?action=add_node&bp='+bp_id+'&node='+node.id, data, function() {
        bp_refresh(bp_id);
    });
    return false;
}

/* save menu for later restore */
var original_menu;
function bp_menu_save() {
    if(!original_menu) {
        original_menu = jQuery('#bp_menu').html();
    }
}

/* set status data */
function bp_update_status(evt, node) {
    evt = (evt) ? evt : ((window.event) ? event : null);
    if(node == null) {
        return false;
    }
    if(bp_active_node != undefined && bp_active_node != node.id) {
        return false;
    }
    var n = bp_get_node(node.id);

    var status = n.status;
    if(status == 0) { statusName = 'OK'; }
    if(status == 1) { statusName = 'WARNING'; }
    if(status == 2) { statusName = 'CRITICAL'; }
    if(status == 3) { statusName = 'UNKNOWN'; }
    if(status == 4) { statusName = 'PENDING'; }
    jQuery('#bp_status_status').html('<div class="statusField status'+statusName+'">  '+statusName+'  </div>');
    jQuery('#bp_status_label').html(n.label);
    jQuery('#bp_status_plugin_output').html(n.status_text);
    jQuery('#bp_status_last_check').html(n.last_check);
    jQuery('#bp_status_duration').html(n.duration);
    jQuery('#bp_status_function').html(n.func + '('+n.func_args.join(', ')+')');
    return false;
}

/* return node object by id */
function bp_get_node(id) {
    var node;
    nodes.forEach(function(n) {
        if(n.id == id) {
            node = n;
            return false;
        }
    });
    return node;
}

/* do the layout */
function bp_render(containerId, nodes, edges) {
    dagre.layout()
        //.debugLevel(4)
        .nodes(nodes)
        .edges(edges)
        .nodeSep(20)
        .rankDir("TB")
        .run();

    var maxX = 0, maxY = 0, minY = -1, main_node;
    nodes.forEach(function(u) {
        // move node
        jQuery('#'+u.dagre.id).css('left', (u.dagre.x-55)+'px').css('top', (u.dagre.y-15)+'px');
        if(maxX < u.dagre.x) { maxX = u.dagre.x }
        if(maxY < u.dagre.y) { maxY = u.dagre.y }
        if(minY == -1 || u.dagre.y < minY) { minY = u.dagre.y; main_node = u; }
    });
    maxX = maxX + 80;
    maxY = maxY + 30;

    edges.forEach(function(e) {
        bp_plump('inner_'+containerId, e.sourceId, e.targetId);
    });

    // adjust size of container
    var container = document.getElementById(containerId);
    var w = jQuery(window).width() - container.parentNode.offsetLeft - 320;
    var h = jQuery(window).height() - container.parentNode.offsetTop -  10;
    container.style.width  = w+'px';
    container.style.height = h+'px';

    // do we need to zoom in?
    var zoomX = 1, zoomY = 1;
    if(w < maxX) {
        zoomX = w / maxX;
    }
    if(h < maxY) {
        zoomY = h / maxY;
    }
    var zoom = zoomY;
    if(zoomX < zoomY) { zoom = zoomX; }
    if(zoom < 1) {
        bp_zoom('inner_'+containerId, zoom);
    }
    original_zoom = zoom;

    if(!current_node) {
        bp_update_status(null, main_node);
    }

    return;
}

/* zoom out */
var last_zoom = 1;
function bp_zoom_rel(containerId, zoom) {
    bp_zoom(containerId, last_zoom + zoom);
    return false;
}

function bp_zoom_reset(containerId) {
    bp_zoom(containerId, original_zoom);
    return false;
}

/* set zoom level */
function bp_zoom(containerId, zoom) {
    // round to 0.05
    zoom = Math.round(zoom * 20) / 20;
    last_zoom = zoom;
    jQuery('#'+containerId).css('zoom', zoom)
                                 .css('-moz-transform', 'scale('+zoom+')')
                                 .css('-moz-transform-origin', '0 0');
}

/* draw connector between two nodes */
function bp_plump(containerId, sourceId, targetId) {
    var upper     = document.getElementById(sourceId);
    var lower     = document.getElementById(targetId);
    var container = document.getElementById(containerId);

    // get position
    var lpos = jQuery(lower).position();
    var upos = jQuery(upper).position();

    // switch position
    if(lpos.top < upos.top) {
        var tmp = lower;
        lower = upper;
        upper = tmp;

        var tmp = lpos;
        lpos = upos;
        upos = tmp;
    }

    // draw "line" from top middle of lower node
    var x = lpos.left + lower.offsetWidth / 2;
    var y = lpos.top  - 10;
    jQuery(container).append('<div class="bp_vedge" style="left: '+x+'px; top: '+y+'px; width:1px; height: 10px;"><\/div>');

    // draw vertical line
    var w = (upos.left + upper.offsetWidth / 2) - x;
    if(w < 0) {
        w = -w;
        x = x - w;
    } else {
        x = x + 2;
    }
    jQuery(container).append('<div class="bp_hedge" style="left: '+x+'px; top: '+y+'px; width:'+w+'px; height: 1px;"><\/div>');

    // draw horizontal line
    x = upos.left + upper.offsetWidth / 2;
    y = lpos.top  - 10;
    var h = y - (upos.top + upper.offsetHeight);
    y = y - h;
    jQuery(container).append('<div class="bp_vedge" style="left: '+x+'px; top: '+y+'px; width:1px; height: '+h+'px;"><\/div>');

    return;
}

/* stop further events */
function bp_no_more_events(evt) {
    if (evt.stopPropagation) {
        evt.stopPropagation();
    }
    if(evt.preventDefault != undefined) {
        evt.preventDefault();
    }
    evt.cancelBubble = true;
    return false;
}
